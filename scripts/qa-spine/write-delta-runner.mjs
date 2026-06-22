#!/usr/bin/env node
/**
 * QA Spine — WRITE-DELTA RUNNER (the unattended nightly orchestrator).
 *
 * Closes the write-delta money-canary loop with ZERO per-run human action. It is
 * the AUTOMATION of the manual operator handoff in
 * docs/ux-audit/qa-spine/write-delta-canary.md §4 — on a dedicated persistent
 * writable QA tenant, on a nightly cron, it:
 *
 *     restock fixture (if low)
 *     └─ loop k times:
 *          oracle BEFORE  (finance + inventory, admin-gated → authed session)
 *          one REAL sale  (write-delta-sale.mjs — anonymous storefront, or POS)
 *          oracle AFTER
 *          assert A1–A5   (write-delta-core.mjs — pure engine)
 *     aggregate → pass^k  (a 90% one-shot is only ~59% at k=5: reliability is the bar)
 *     scorecard artifact + exit non-zero on ANY failure (red ⇒ alert)
 *
 * It REUSES the three existing pieces unchanged in spirit:
 *   • write-delta-core.mjs  — the pure A1–A5 assertion engine.
 *   • write-delta-sale.mjs  — the Playwright sale driver (spawned per iteration).
 *   • the MCP-oracle idea    — but the oracle is no longer "the agent runs MCP";
 *     it is an AUTHED Playwright session reading the SHIPPED FinanceBridge cores
 *     (loadRevenueAggregate / computePnl) + admin/inventory, the same surface the
 *     read-side money canary cross-checks (money-canary.mjs mode B).
 *
 * ── THE ONE CREDENTIAL ────────────────────────────────────────────────────────
 * The sale is anonymous (storefront guest checkout signs in anonymously — no
 * credential). The ONLY admin-gated piece is the finance/inventory oracle (+ the
 * optional restock write). That needs ONE stored credential: a captured authed
 * admin Playwright storageState, supplied to CI as a single secret. Mint it once
 * with scripts/qa-spine/capture-qa-storage-state.mjs. Agents are firewalled from
 * setting CI secrets → that capture+add is the single irreducible operator step.
 *
 * ── ORACLE MODES ──────────────────────────────────────────────────────────────
 *   browser (default)  authed Playwright → FinanceBridge + admin/inventory. The
 *                      unattended production path. Needs MAST_QA_STORAGE_STATE.
 *   mock               deterministic synthetic oracle that APPLIES the sale's
 *                      expected effect between before/after. Validates the whole
 *                      orchestration (restock-skip → sale subprocess → assert →
 *                      aggregate → scorecard → exit) with NO credential and NO
 *                      irreversible write (the sale driver runs --dry-run). This
 *                      is what proves the wiring offline / in smoke.
 *
 * Env (flags override; see parseConfig):
 *   MAST_TENANT            (required) e.g. qa-write-canary
 *   MAST_BASE_URL          (required) e.g. https://<tenant>.runmast.com
 *   MAST_QA_STORAGE_STATE  (browser mode) base64 of an authed admin storageState JSON — THE SECRET
 *   ORACLE                 browser | mock                 (default browser)
 *   SURFACE                storefront | pos               (default storefront)
 *   EXPECTED_CHANNEL       (default: storefront→dtc_online, pos→in_person)
 *   FIXTURE_PID            (default qa-write-canary)
 *   WITNESS_PIDS           comma-separated collateral witnesses for A5 (optional)
 *   SALE_QTY               (default 1)
 *   K                      iterations (default 5)
 *   SALE_RETRIES           driver retries per iteration on an INFRA flake (default 2)
 *   DELTA_CENTS            fallback expected T if the driver can't capture the
 *                          checkout total (default 2500 = the $25 fixture)
 *   REVENUE_WINDOW_START   oracle window start (default 2024-01-01; MUST include today)
 *   REVENUE_WINDOW_END     oracle window end   (default 2027-12-31)
 *   SETTLE_MS              wait after the sale fires before the AFTER snapshot (default 4000)
 *   OUT_DIR                (default qa-spine-out)
 *   HEADLESS               "0" to watch (default headless)
 *
 * Exit: 0 = pass^k green; 1 = a divergence or an unrecoverable infra failure; 2 = bad invocation.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { assertWriteDelta, getCanonicalChannels, dollars } from './write-delta-core.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SALE_SCRIPT = join(__dirname, 'write-delta-sale.mjs');

// ── config ────────────────────────────────────────────────────────────────────
function parseConfig() {
  const e = process.env;
  const surface = (e.SURFACE || 'storefront').toLowerCase();
  return {
    tenant: e.MAST_TENANT || '',
    baseUrl: e.MAST_BASE_URL || '',
    storageB64: e.MAST_QA_STORAGE_STATE || '',
    oracle: (e.ORACLE || 'browser').toLowerCase(),
    surface,
    channel: e.EXPECTED_CHANNEL || (surface === 'pos' ? 'in_person' : 'dtc_online'),
    fixturePid: e.FIXTURE_PID || 'qa-write-canary',
    witnessPids: (e.WITNESS_PIDS || '').split(',').map((s) => s.trim()).filter(Boolean),
    qty: Number(e.SALE_QTY || 1),
    k: Number(e.K || 5),
    saleRetries: Number(e.SALE_RETRIES || 2),
    fallbackDelta: Number(e.DELTA_CENTS || 2500),
    winStart: e.REVENUE_WINDOW_START || '2024-01-01',
    winEnd: e.REVENUE_WINDOW_END || '2027-12-31',
    settleMs: Number(e.SETTLE_MS || 4000),
    out: e.OUT_DIR || 'qa-spine-out',
    headless: e.HEADLESS !== '0',
  };
}

// ════════════════════════════════════════════════════════════════════════════
// PURE transforms (offline-testable — verified against the live MCP/app shapes).
// ════════════════════════════════════════════════════════════════════════════

/**
 * Canonical inventory totals from a RAW admin/inventory/{pid} doc. Mirrors the
 * mast-mcp-server stockInfo computation (src/shared/tools/products.ts): sum across
 * variant combos, else _default; available = max(0, onHand-committed-held-damaged).
 * Pure → unit-tested in test/write-delta-runner.test.js with the exact shapes the
 * live oracle returns.
 */
export function computeStockTotals(invDoc) {
  if (!invDoc) return null;
  let rawStock = invDoc.stock;
  const stockType = invDoc.stockType || 'build-to-order';
  // Tolerate the bare stock-map shape too ({_default:{…}} / {variantKey:{…}}) in
  // case MastDB.get returns the map rather than the wrapping doc (path-shape varies).
  if (rawStock == null && (invDoc._default || Object.values(invDoc).some((v) => v && typeof v === 'object' && 'onHand' in v))) rawStock = invDoc;
  if (typeof rawStock === 'number') rawStock = { _default: { onHand: rawStock } };
  rawStock = rawStock || {};
  let onHand = 0, committed = 0, held = 0, damaged = 0;
  const variantKeys = Object.keys(rawStock).filter((k) => k !== '_default');
  if (variantKeys.length) {
    for (const k of variantKeys) {
      const x = rawStock[k] || {};
      onHand += x.onHand || 0; committed += x.committed || 0; held += x.held || 0; damaged += x.damaged || 0;
    }
  } else if (rawStock._default) {
    const x = rawStock._default;
    onHand = x.onHand || 0; committed = x.committed || 0; held = x.held || 0; damaged = x.damaged || 0;
  }
  const totalAvailable = Math.max(0, onHand - committed - held - damaged);
  return { stockType, totalOnHand: onHand, totalAvailable, totalCommitted: committed };
}

/**
 * Map the RAW bridge/DB outputs the in-page evaluate() returns into the canary's
 * snapshot shape (what write-delta-core consumes). The load-bearing detail: the
 * shipped FinanceBridge returns revenue as `totalCents` and P&L opex as `opex`,
 * while the engine asserts on `revenue.total` and `pnl.operatingExpenses` — this
 * is where they're reconciled (a silent mismatch makes A4c read NaN). Pure.
 */
export function buildSnapshot(raw) {
  const rev = (raw && raw.rev) || {};
  const pnl = (raw && raw.pnl) || {};
  const products = {};
  for (const [pid, doc] of Object.entries((raw && raw.inv) || {})) products[pid] = computeStockTotals(doc);
  const missing = Number(pnl.cogsLineMissingCount) || 0;
  return {
    revenue: { total: Number(rev.totalCents != null ? rev.totalCents : rev.total) || 0, byChannel: rev.byChannel || {} },
    pnl: {
      revenue: Number(pnl.revenue) || 0,
      cogs: Number(pnl.cogs) || 0,
      grossProfit: Number(pnl.grossProfit) || 0,
      operatingExpenses: Number(pnl.opex != null ? pnl.opex : pnl.operatingExpenses) || 0,
      netProfit: Number(pnl.netProfit) || 0,
      marginReliable: !(missing > 0 || !!pnl.cogsMissing),
      cogsLineMissingCount: missing,
      cogsMissing: !!pnl.cogsMissing,
    },
    products,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// MOCK oracle — deterministic; APPLIES the sale's expected effect between snaps.
// Lets the full loop run with no credential + no irreversible write.
// ════════════════════════════════════════════════════════════════════════════
function makeMockOracle(cfg) {
  const reserve = cfg.channel !== 'in_person';
  const st = { revTotal: 100000, ch: 50000, onHand: 100, committed: 0 };
  const witnesses = Object.fromEntries(cfg.witnessPids.map((p) => [p, { stockType: 'strict', totalOnHand: 7, totalAvailable: 7, totalCommitted: 0 }]));
  const snap = () => {
    const fixture = { stockType: 'strict', totalOnHand: st.onHand, totalAvailable: Math.max(0, st.onHand - st.committed), totalCommitted: st.committed };
    return {
      revenue: { total: st.revTotal, byChannel: { [cfg.channel]: st.ch, in_person: 31337 } },
      pnl: { revenue: st.revTotal, cogs: 40000, grossProfit: st.revTotal - 40000, operatingExpenses: 20000, netProfit: st.revTotal - 60000, marginReliable: true, cogsLineMissingCount: 0, cogsMissing: false },
      products: { [cfg.fixturePid]: fixture, ...JSON.parse(JSON.stringify(witnesses)) },
    };
  };
  return {
    label: 'mock',
    snapshot: async () => snap(),
    restockIfLow: async () => ({ restocked: false, available: st.onHand - st.committed, mode: 'mock' }),
    applySale: (T, qty) => { st.revTotal += T; st.ch += T; if (reserve) st.committed += qty; else st.onHand -= qty; },
    close: async () => {},
  };
}

// ════════════════════════════════════════════════════════════════════════════
// BROWSER oracle — the unattended production path. Authed admin session reads the
// SHIPPED FinanceBridge cores + admin/inventory. Built on money-canary.mjs mode B.
// ════════════════════════════════════════════════════════════════════════════
async function makeBrowserOracle(cfg, storagePath) {
  let chromium;
  try { ({ chromium } = await import('playwright')); }
  catch { throw new Error('playwright not installed — `npm i playwright` (the nightly workflow installs ≥1.51 for IndexedDB storageState).'); }
  const browser = await chromium.launch({ headless: cfg.headless });
  const context = await browser.newContext({ storageState: storagePath });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));

  // Load the admin finance route so FinanceBridge + MastDB are present and authed.
  await page.goto(`${cfg.baseUrl}/app/#finance-pl-v2`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.MAST_MODULES_V, { timeout: 20000 }).catch(() => {});
  // Verify we are an authed NON-anonymous admin — fail fast + loud otherwise (the
  // single most likely failure: an expired/rotated storageState secret).
  const who = await page.evaluate(() => {
    try { const u = (window.firebase && firebase.auth) ? firebase.auth().currentUser : null; return u ? { uid: u.uid, anon: !!u.isAnonymous } : null; }
    catch (e) { return { err: String(e && e.message || e) }; }
  }).catch(() => null);
  if (!who || who.err || !who.uid || who.anon) {
    await browser.close();
    throw new Error(`oracle not authenticated (currentUser=${JSON.stringify(who)}). The MAST_QA_STORAGE_STATE secret is missing/expired/anonymous — re-capture it with capture-qa-storage-state.mjs.`);
  }
  // Wait for FinanceBridge (route-lazy).
  await page.waitForFunction(() => !!(window.FinanceBridge && window.MastDB), { timeout: 20000 })
    .catch(() => { throw new Error('FinanceBridge/MastDB never appeared on the admin window — confirm the finance route hash + that the admin build exposes these globals.'); });

  async function rawRead() {
    return await page.evaluate(async ({ start, end, pids }) => {
      const out = { rev: null, pnl: null, inv: {}, errors: [] };
      try {
        const B = window.FinanceBridge;
        out.rev = await B.loadRevenueAggregate(start, end);  // { totalCents, byChannel, txnCount }
        out.pnl = await B.computePnl(start, end);             // { revenue, cogs, grossProfit, opex, netProfit, cogsLineMissingCount, cogsMissing, ... }
      } catch (e) { out.errors.push('finance: ' + String(e && e.message || e)); }
      for (const pid of pids) {
        try { out.inv[pid] = await window.MastDB.get('admin/inventory/' + pid); }  // RAW doc (MastDB.get returns raw)
        catch (e) { out.errors.push('inv ' + pid + ': ' + String(e && e.message || e)); }
      }
      return out;
    }, { start: cfg.winStart, end: cfg.winEnd, pids: [cfg.fixturePid, ...cfg.witnessPids] });
  }

  return {
    label: `browser(${who.uid.slice(0, 6)}…)`,
    snapshot: async () => {
      const raw = await rawRead();
      if (raw.errors.length || !raw.rev) throw new Error('oracle read failed: ' + (raw.errors.join('; ') || 'no revenue'));
      return buildSnapshot(raw);
    },
    // Restock only when low (the canary asserts DELTAS, so accumulating orders are
    // fine — only the fixture's sellable stock must outlast k sales). Mirrors the
    // admin inventory writer (inventory-stock-ops.js): a direct admin MastDB.update.
    restockIfLow: async (need) => {
      const raw = await page.evaluate((p) => window.MastDB.get('admin/inventory/' + p), cfg.fixturePid);
      const t = computeStockTotals(raw) || { totalAvailable: 0, totalCommitted: 0 };
      if (t.totalAvailable >= need) return { restocked: false, available: t.totalAvailable };
      const target = 100 + (t.totalCommitted || 0);
      // Faithful to the shipped admin inventory writer (inventory-stock-ops.js):
      // MastDB.inventory.update(pid, {'stock._default.onHand': N, 'updatedAt': …}).
      const res = await page.evaluate(async ({ p, target }) => {
        try { await window.MastDB.inventory.update(p, { 'stock._default.onHand': target, updatedAt: new Date().toISOString() }); return { ok: true }; }
        catch (e) { return { ok: false, err: String(e && e.message || e) }; }
      }, { p: cfg.fixturePid, target });
      return { restocked: res.ok, target, error: res.err || null, available: t.totalAvailable };
    },
    applySale: () => {},  // no-op: the real write moves real books
    close: async () => { await browser.close(); },
  };
}

// ── sale driver (spawn write-delta-sale.mjs; retry on INFRA flake) ──────────────
function driveSale(cfg, storagePath, iterDir, { dryRun }) {
  const env = {
    ...process.env,
    MAST_BASE_URL: cfg.baseUrl, FIXTURE_PID: cfg.fixturePid, SALE_QTY: String(cfg.qty),
    SURFACE: cfg.surface, OUT_DIR: iterDir, HEADLESS: cfg.headless ? '1' : '0',
    DRY_RUN: dryRun ? '1' : '',
  };
  if (cfg.surface === 'pos' && storagePath) env.MAST_STORAGE_STATE = storagePath;
  let last = null;
  for (let attempt = 1; attempt <= cfg.saleRetries + 1; attempt++) {
    spawnSync('node', [SALE_SCRIPT], { env, stdio: 'inherit' });
    let res = null;
    try { res = JSON.parse(readFileSync(join(iterDir, `write-delta-sale-${cfg.surface}.json`), 'utf8')); } catch { /* no result */ }
    last = res;
    // A sale "fired" = the irreversible submitOrder went out (live), OR the dry-run
    // located place-order. Benign storefront pageErrors (a guest permission read)
    // are tolerated — we gate on the cut point, not the driver's strict success.
    const placed = res && res.steps && res.steps.length && res.steps[res.steps.length - 1].ok;
    const fired = dryRun ? placed : !!(res && res.submitObserved);
    if (fired) return { ok: true, attempt, result: res, checkoutTotalCents: res.checkoutTotalCents || null };
    console.log(`  ↻ sale attempt ${attempt} did not ${dryRun ? 'reach place-order' : 'fire submitOrder'} — ${attempt <= cfg.saleRetries ? 'retrying' : 'giving up'}`);
  }
  return { ok: false, attempt: cfg.saleRetries + 1, result: last, checkoutTotalCents: last && last.checkoutTotalCents || null };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ════════════════════════════════════════════════════════════════════════════
// main
// ════════════════════════════════════════════════════════════════════════════
async function main() {
  const cfg = parseConfig();
  if (!cfg.baseUrl || !cfg.tenant) {
    console.error('write-delta-runner: MAST_TENANT and MAST_BASE_URL are required.');
    process.exit(2);
  }
  if (cfg.oracle === 'browser' && !cfg.storageB64) {
    console.error('write-delta-runner: ORACLE=browser needs MAST_QA_STORAGE_STATE (base64 authed admin storageState). Use ORACLE=mock to validate the wiring without a credential.');
    process.exit(2);
  }
  mkdirSync(cfg.out, { recursive: true });
  const CANON = getCanonicalChannels();

  // Materialize the credential to a temp file (browser/pos).
  let storagePath = null;
  if (cfg.storageB64) {
    storagePath = join(tmpdir(), `qa-storage-state-${process.pid}.json`);
    try { writeFileSync(storagePath, Buffer.from(cfg.storageB64, 'base64').toString('utf8')); }
    catch (e) { console.error('write-delta-runner: could not decode MAST_QA_STORAGE_STATE (expected base64 of a storageState JSON):', e.message); process.exit(2); }
  }

  console.log(`\n══ WRITE-DELTA RUNNER · tenant=${cfg.tenant} · surface=${cfg.surface} · channel=${cfg.channel} · k=${cfg.k} · oracle=${cfg.oracle} ══`);
  console.log(`   ${cfg.baseUrl} · fixture=${cfg.fixturePid} · qty=${cfg.qty} · window ${cfg.winStart}..${cfg.winEnd}`);

  const dryRun = cfg.oracle === 'mock'; // mock validates the wiring → never an irreversible write
  let oracle;
  try { oracle = cfg.oracle === 'mock' ? makeMockOracle(cfg) : await makeBrowserOracle(cfg, storagePath); }
  catch (e) { console.error('\n✗ oracle init failed:', e.message); cleanup(storagePath); process.exit(1); }
  console.log(`   oracle ready: ${oracle.label}`);

  const scorecard = {
    probe: 'write-delta-runner', tenant: cfg.tenant, baseUrl: cfg.baseUrl, surface: cfg.surface,
    channel: cfg.channel, fixturePid: cfg.fixturePid, qty: cfg.qty, k: cfg.k, oracleMode: cfg.oracle,
    window: { start: cfg.winStart, end: cfg.winEnd }, startedAt: new Date().toISOString(),
    restock: null, perIteration: [], infra: [], passes: 0, passHatK: false,
  };

  // ── restock (once, up front) ──
  try {
    scorecard.restock = await oracle.restockIfLow(cfg.k * cfg.qty + 2);
    console.log(`   restock: ${scorecard.restock.restocked ? `topped up → onHand ${scorecard.restock.target}` : `not needed (available ${scorecard.restock.available})`}${scorecard.restock.error ? ' ⚠ ' + scorecard.restock.error : ''}`);
  } catch (e) {
    scorecard.restock = { restocked: false, error: e.message };
    console.log(`   restock check failed (non-fatal): ${e.message}`);
  }

  // ── k iterations ──
  for (let i = 1; i <= cfg.k; i++) {
    const iterDir = join(cfg.out, `iter-${String(i).padStart(2, '0')}`);
    mkdirSync(iterDir, { recursive: true });
    console.log(`\n── iteration ${i}/${cfg.k} ──`);
    const rec = { iteration: i, pass: false, saleFired: false, attempts: 0, T: null, revenueDelta: null, failures: [], note: null };
    try {
      const before = await oracle.snapshot();
      const sale = driveSale(cfg, storagePath, iterDir, { dryRun });
      rec.saleFired = sale.ok; rec.attempts = sale.attempt;
      const T = sale.checkoutTotalCents || cfg.fallbackDelta;
      rec.T = T;
      if (!sale.ok) {
        rec.note = 'sale never fired after retries (infra flake, not a money signal)';
        scorecard.infra.push({ iteration: i, reason: rec.note });
        console.log(`  ✗ ${rec.note}`);
        scorecard.perIteration.push(rec);
        continue;
      }
      if (dryRun) oracle.applySale(T, cfg.qty);   // mock: synthesize the expected effect
      await sleep(cfg.settleMs);                   // let the write propagate to the oracle reads
      const after = oracle.snapshot ? await oracle.snapshot() : null;
      const expect = { deltaCents: T, channel: cfg.channel, fixturePid: cfg.fixturePid, qty: cfg.qty };
      const res = assertWriteDelta(before, after, expect, CANON);
      rec.pass = res.pass;
      rec.revenueDelta = res.deltas.revenue;
      rec.failures = res.assertions.filter((a) => !a.pass).map((a) => a.name);
      // persist the full iteration scorecard (interop with write-delta-canary.mjs format)
      writeFileSync(join(cfg.out, `write-delta-iter-${String(i).padStart(2, '0')}.json`), JSON.stringify({
        probe: 'write-delta-canary', iteration: i, expect, startedAt: new Date().toISOString(),
        deltas: res.deltas, assertions: res.assertions, pass: res.pass, oracle: { before, after },
      }, null, 2));
      for (const a of res.assertions) console.log(`  ${a.pass ? '✔' : '✗ FAIL'} ${a.name}: expected=${a.expected} actual=${a.actual}${a.note ? ' (' + a.note + ')' : ''}`);
      console.log(`  iteration ${i}: ${res.pass ? 'PASS' : 'FAIL'} · T=${dollars(T)} · Δrev=${res.deltas.revenue}`);
    } catch (e) {
      rec.note = 'iteration error: ' + e.message;
      scorecard.infra.push({ iteration: i, reason: rec.note });
      console.log(`  ✗ ${rec.note}`);
    }
    scorecard.perIteration.push(rec);
  }

  await oracle.close();
  cleanup(storagePath);

  // ── aggregate → pass^k ──
  scorecard.passes = scorecard.perIteration.filter((p) => p.pass).length;
  scorecard.passHatK = scorecard.passes === cfg.k && scorecard.infra.length === 0;
  scorecard.finishedAt = new Date().toISOString();
  const file = join(cfg.out, 'qa-canary-scorecard.json');
  writeFileSync(file, JSON.stringify(scorecard, null, 2));

  console.log(`\n══ WRITE-DELTA RUNNER · pass^k ══`);
  console.log(`  k=${cfg.k}  passes=${scorecard.passes}  infra-failures=${scorecard.infra.length}`);
  console.log(`  pass^${cfg.k} = ${scorecard.passHatK ? 'PASS ✔ (reliable)' : 'FAIL ✗'}`);
  for (const p of scorecard.perIteration) console.log(`   iter ${p.iteration}: ${p.pass ? 'PASS' : 'FAIL'}${p.failures.length ? ' [' + p.failures.map((f) => f.split(' ')[0]).join(',') + ']' : ''}${p.note ? ' — ' + p.note : ''}`);
  console.log(`→ ${file}`);
  process.exit(scorecard.passHatK ? 0 : 1);
}

function cleanup(storagePath) { if (storagePath) { try { rmSync(storagePath, { force: true }); } catch { /* best effort */ } } }

// Only run the loop when invoked directly — importing for unit tests (the pure
// buildSnapshot/computeStockTotals transforms) must NOT kick off a live run.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error('write-delta-runner fatal:', e); process.exit(1); });
}
