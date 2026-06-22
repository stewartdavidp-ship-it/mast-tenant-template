#!/usr/bin/env node
/**
 * QA Spine — MONEY CANARY: cross-surface VALUE assertion (live).
 * NOT a migration script. The deterministic backbone lives in
 * test/money-canary.test.js (CI-gated, no network). THIS probe is the supervised
 * live half: it asserts the SAME money figure agrees across surfaces on a real
 * seeded tenant and FAILS LOUDLY (exit 1) on any divergence. See
 * docs/ux-audit/qa-spine/money-canary.md and phase-3-plan.md §3/§6.
 *
 * It targets the divergence class that needed cross-surface discovery to find:
 * cents-vs-dollars (order.total DOLLARS vs totalCents CENTS), 100x, POS
 * double-count, channel-key fragmentation (F1), and F14 (P&L margin withholding).
 *
 * TWO modes, layered:
 *
 *   (A) ORACLE SELF-CHECK  — runnable TODAY, no auth, no browser. The agent runs
 *       the MCP tool sequence (the MCP *is* the interface) and drops the JSON:
 *           finance_get_revenue → revenue.json   { total, byChannel }
 *           finance_get_pnl      → pnl.json        { revenue, cogs, grossProfit,
 *                                   operatingExpenses, netProfit, marginReliable,
 *                                   cogsLineMissingCount, cogsLineCoveredCount,
 *                                   cogsMissing }
 *       This codifies the W6 reconciliation matrix as an executable gate:
 *       revenue.total==pnl.revenue, gross==revenue-cogs, net==gross-opex,
 *       marginReliable==!(missing>0||cogsMissing), Σ byChannel==total, and every
 *       channel key is CANONICAL (would have caught F1 live).
 *
 *   (B) UI CROSS-CHECK     — adds the rendered admin surface. Needs a WRITABLE
 *       authed Playwright storageState (testmode is read-only DOM). Drives the
 *       finance hub, reads the UI's own computed revenue + the margin cell, and
 *       asserts: UI total == MCP total (to the cent), and UI margin is withheld
 *       ('—') IFF the MCP reports marginReliable:false. Playwright is imported
 *       lazily so mode (A) runs in plain node.
 *
 * Env:
 *   MONEY_REVENUE_JSON  (required) path to the finance_get_revenue payload
 *   MONEY_PNL_JSON      (required) path to the finance_get_pnl payload
 *   MAST_BASE_URL       (optional) e.g. https://<tenant>.<host> — enables mode B.
 *                       No default (keeps the hardcoded-host lint clean).
 *   MAST_STORAGE_STATE  (required for B) Playwright storageState.json (authed)
 *   MAST_TENANT         (record-keeping, default "")
 *   FINANCE_HASH        (mode B) admin route to load (default "finance-pl-v2")
 *   OUT_DIR             output dir (default ./qa-spine-out)
 *   HEADLESS            "0" to watch (default headless)
 *
 * Usage (A):  MONEY_REVENUE_JSON=rev.json MONEY_PNL_JSON=pnl.json \
 *               node scripts/qa-spine/money-canary.mjs
 * Usage (B):  MONEY_REVENUE_JSON=… MONEY_PNL_JSON=… MAST_BASE_URL=… \
 *               MAST_STORAGE_STATE=… node scripts/qa-spine/money-canary.mjs
 *
 * Exit 0 = all surfaces agree; 1 = a divergence (a real money bug or a stale
 * cached bundle — hard-reload and re-run); 2 = bad invocation.
 */
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const REVENUE_JSON = process.env.MONEY_REVENUE_JSON;
const PNL_JSON = process.env.MONEY_PNL_JSON;
const BASE = process.env.MAST_BASE_URL;            // optional → enables mode B
const STORAGE = process.env.MAST_STORAGE_STATE || undefined;
const TENANT = process.env.MAST_TENANT || '';
const FINANCE_HASH = process.env.FINANCE_HASH || 'finance-pl-v2';
const OUT = process.env.OUT_DIR || 'qa-spine-out';
const HEADLESS = process.env.HEADLESS !== '0';

if (!REVENUE_JSON || !PNL_JSON) {
  console.error('MONEY_REVENUE_JSON and MONEY_PNL_JSON are required (MCP oracle payloads).');
  console.error('Run finance_get_revenue + finance_get_pnl for the SAME period and save each as JSON.');
  process.exit(2);
}
mkdirSync(OUT, { recursive: true });

// Load the canonical channel taxonomy (the SAME core both surfaces aggregate on)
// so the live byChannel keys can be checked for fragmentation.
const require = createRequire(import.meta.url);
require('../../shared/channel-normalization.core.js');
const MastChannels = globalThis.MastChannels;
const CANON = new Set(MastChannels ? MastChannels.CHANNELS : []);

const dollars = (cents) => '$' + (Number(cents) / 100).toFixed(2);
const revenue = JSON.parse(readFileSync(REVENUE_JSON, 'utf8'));
const pnl = JSON.parse(readFileSync(PNL_JSON, 'utf8'));

const result = {
  probe: 'money-canary', tenant: TENANT, startedAt: new Date().toISOString(),
  oracle: { revenue, pnl }, assertions: [], uiCrossCheck: null, pass: false,
};
function assertEq(name, expected, actual, note) {
  const pass = expected === actual;
  result.assertions.push({ name, expected, actual, pass, note: note || null });
  console.log(`${pass ? '✔' : '✗ FAIL'} ${name}: expected=${expected} actual=${actual}${note ? '  (' + note + ')' : ''}`);
  return pass;
}
function assertTrue(name, cond, detail) {
  result.assertions.push({ name, expected: true, actual: !!cond, pass: !!cond, note: detail || null });
  console.log(`${cond ? '✔' : '✗ FAIL'} ${name}${detail ? '  (' + detail + ')' : ''}`);
  return !!cond;
}

// ── (A) ORACLE SELF-CHECK — the W6 reconciliation matrix, executable ──────────
console.log('\n── money-canary (A) MCP oracle self-check ──');
// 1. The headline cross-tool agreement: the revenue tool and the P&L tool must
//    report the SAME revenue (both sum orders + POS sales over the period).
assertEq('revenue.total == pnl.revenue', revenue.total, pnl.revenue, dollars(revenue.total));
// 2/3. P&L internal arithmetic.
assertEq('grossProfit == revenue - cogs', pnl.revenue - pnl.cogs, pnl.grossProfit);
assertEq('netProfit == grossProfit - operatingExpenses',
  pnl.grossProfit - pnl.operatingExpenses, pnl.netProfit);
// 4. F14 contract: marginReliable is exactly the UI's withhold gate, negated.
const expectReliable = !(((pnl.cogsLineMissingCount || 0) > 0) || pnl.cogsMissing);
assertEq('marginReliable == !(cogsLineMissingCount>0 || cogsMissing)', expectReliable, !!pnl.marginReliable,
  pnl.marginReliable ? 'margin trustworthy' : 'UI withholds gross/net');
// 5. No channel leaks past the grand total.
const chanSum = Object.values(revenue.byChannel || {}).reduce((a, b) => a + Number(b), 0);
assertEq('Σ revenue.byChannel == revenue.total', revenue.total, chanSum);
// 6. Every live channel key is canonical (catches F1-class fragmentation live).
const badChannels = Object.keys(revenue.byChannel || {}).filter((k) => !CANON.has(k));
assertTrue('all revenue channels are canonical (no fragmentation)', badChannels.length === 0,
  badChannels.length ? 'non-canonical: ' + badChannels.join(', ') : 'keys: ' + Object.keys(revenue.byChannel || {}).join(', '));

// ── (B) UI CROSS-CHECK — rendered admin surface vs the MCP oracle ─────────────
async function uiCrossCheck() {
  let chromium;
  try { ({ chromium } = await import('playwright')); }
  catch { console.log('\n(skip B) playwright not installed — run `npm ci` in scripts/ for the UI cross-check.'); return; }
  console.log(`\n── money-canary (B) UI cross-check @ ${BASE}/app/#${FINANCE_HASH} ──`);
  const browser = await chromium.launch({ headless: HEADLESS });
  const ctx = await browser.newContext(STORAGE ? { storageState: STORAGE } : {});
  const page = await ctx.newPage();
  const ui = { loaded: false, totalCents: null, marginWithheld: null, errors: [] };
  page.on('pageerror', (e) => ui.errors.push(String(e)));
  try {
    await page.goto(`${BASE}/app/#${FINANCE_HASH}`, { waitUntil: 'networkidle' });
    // Stale-bundle guard (memory: hash-nav can serve a cached module bundle).
    await page.waitForFunction(() => !!window.MAST_MODULES_V, { timeout: 15000 });
    ui.loaded = true;
    // Prefer the UI's OWN computed figure over scraping pixels: finance.js
    // exposes the aggregator via FinanceBridge on the admin window. This runs the
    // SHIPPED finance.js — the genuine UI surface — for the same all-time window.
    // TODO(first authed run): confirm the bridge accessor + period args against the
    // live app; fall back to a money-regex scrape of the rendered revenue card.
    ui.totalCents = await page.evaluate(async () => {
      try {
        const B = window.FinanceBridge;
        if (B && typeof B.loadRevenueAggregate === 'function') {
          const r = await B.loadRevenueAggregate('2020-01-01', '2026-12-31');
          return (r && (r.totalCents ?? r.total)) ?? null;
        }
      } catch (e) { /* fall through to scrape */ }
      return null;
    });
    // Margin withhold: the UI renders '—' / "Margin withheld" when COGS is
    // incomplete. Detect the sentinel text in the P&L pane.
    ui.marginWithheld = await page.evaluate(() => {
      const t = (document.body.innerText || '');
      return /Margin withheld|COGS incomplete/i.test(t);
    });
  } catch (e) {
    ui.errors.push(String(e?.message || e));
  } finally {
    try { await page.screenshot({ path: join(OUT, 'money-canary-ui.png') }); } catch {}
    await browser.close();
  }
  result.uiCrossCheck = ui;

  if (ui.totalCents != null) {
    assertEq('UI revenue == MCP revenue (to the cent)', revenue.total, ui.totalCents, dollars(revenue.total));
  } else {
    assertTrue('UI revenue read', false, 'could not read UI revenue (fill the FinanceBridge accessor / scrape selector)');
  }
  // Margin-withhold parity: UI withheld IFF MCP says margin unreliable.
  assertEq('UI margin-withheld == MCP !marginReliable', !pnl.marginReliable, !!ui.marginWithheld,
    pnl.marginReliable ? 'expect margin shown' : 'expect margin withheld');
}

if (BASE) {
  await uiCrossCheck();
} else {
  console.log('\n(skip B) MAST_BASE_URL unset — oracle self-check only. Set MAST_BASE_URL + MAST_STORAGE_STATE for the UI cross-check.');
}

result.pass = result.assertions.every((a) => a.pass);
result.finishedAt = new Date().toISOString();
writeFileSync(join(OUT, 'money-canary-result.json'), JSON.stringify(result, null, 2));
console.log(`\nmoney-canary: ${result.pass ? 'PASS — all surfaces agree' : 'FAIL — divergence (see above; re-run after a hard-reload to rule out a stale bundle)'}`);
console.log(`→ ${join(OUT, 'money-canary-result.json')}`);
process.exit(result.pass ? 0 : 1);
