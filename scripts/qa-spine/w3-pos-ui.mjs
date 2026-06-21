#!/usr/bin/env node
/**
 * QA Spine — W3 UI runner: "In-person POS sale → books".
 * NOT a migration script. Drives the admin POS in a real browser and records the
 * Lens-2 (human ease-of-use) metrics: per-step success, time-on-task, error count,
 * console/page errors, plus a screenshot per step. Emits the UI half of scorecard-W3.json.
 *
 * The reusable core is the step-runner + metric capture; only `posSteps()` is W3-specific.
 *
 * Prereqs (see ../../docs/ux-audit/qa-spine/W3-pilot.md §6 and the boot-smoke recipe in
 * memory: playwright is a dep of scripts/package.json):
 *   - A WRITABLE authed session. `testmode` is write-denied, so pass a Playwright
 *     storageState JSON captured from a logged-in admin session.
 * Env:
 *   MAST_BASE_URL      (required) e.g. https://<tenant>.<host>   — no default (keeps the
 *                      hardcoded-host lint clean; supply per-run)
 *   MAST_STORAGE_STATE (required for writes) path to storageState.json
 *   MAST_TENANT        (record-keeping only, default "sgtest15")
 *   OUT_DIR            output dir (default ./qa-spine-out)
 *   HEADLESS           "0" to watch (default headless)
 *
 * Usage:  MAST_BASE_URL=… MAST_STORAGE_STATE=… node scripts/qa-spine/w3-pos-ui.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.env.MAST_BASE_URL;
const STORAGE = process.env.MAST_STORAGE_STATE || undefined;
const TENANT = process.env.MAST_TENANT || '';
const OUT = process.env.OUT_DIR || 'qa-spine-out';
const HEADLESS = process.env.HEADLESS !== '0';
const FIXTURE_PID = 'qa-w3-widget';
const SALE_TOTAL_CENTS = 2500;

if (!BASE) { console.error('MAST_BASE_URL is required (e.g. https://<tenant>.<host>)'); process.exit(2); }
mkdirSync(OUT, { recursive: true });

const result = {
  workflow: 'W3', surface: 'ui', tenant: TENANT, baseUrl: BASE,
  startedAt: new Date().toISOString(), steps: [], consoleErrors: [], pageErrors: [],
  totalMs: 0, errorCount: 0, success: false,
};

const browser = await chromium.launch({ headless: HEADLESS });
const context = await browser.newContext(STORAGE ? { storageState: STORAGE } : {});
const page = await context.newPage();
page.on('console', m => { if (m.type() === 'error') result.consoleErrors.push(m.text()); });
page.on('pageerror', e => result.pageErrors.push(String(e)));

let idx = 0;
async function step(name, fn) {
  const t0 = Date.now();
  const rec = { i: ++idx, name, ok: false, ms: 0, error: null, shot: null };
  try {
    await fn();
    rec.ok = true;
  } catch (e) {
    rec.error = String(e?.message || e);
    result.errorCount++;
  } finally {
    rec.ms = Date.now() - t0;
    try { rec.shot = join(OUT, `w3-${String(rec.i).padStart(2, '0')}-${name.replace(/\W+/g, '_')}.png`); await page.screenshot({ path: rec.shot, fullPage: false }); } catch {}
    result.steps.push(rec);
  }
  return rec.ok;
}

// --- W3-specific sequence. SELECTORS marked TODO: fill from the live DOM on first authed
// --- run (the admin POS DOM can't be read in testmode). Each step is one user intent.
async function posSteps() {
  await step('load admin', async () => {
    await page.goto(BASE, { waitUntil: 'networkidle' });
    // Stale-code guard (memory: hash-nav serves stale bundle). Confirm a build marker loaded.
    await page.waitForFunction(() => !!window.MAST_MODULES_V, { timeout: 15000 });
  });
  await step('open POS', async () => {
    await page.goto(`${BASE}/app/#pos`, { waitUntil: 'networkidle' });
    // TODO: await page.getByRole('button', { name: /new sale|start sale/i }).click();
  });
  await step('add fixture item', async () => {
    // TODO: search/scan for FIXTURE_PID and add to cart, e.g.:
    // await page.getByPlaceholder(/search|scan/i).fill('QA Spine W3 Widget');
    // await page.getByText('QA Spine W3 Widget').click();
    throw new Error('TODO: fill POS add-item selectors from live DOM');
  });
  await step('take payment (cash/test)', async () => {
    // TODO: choose cash/test tender, enter exact amount, confirm.
  });
  await step('complete sale', async () => {
    // TODO: click Complete/Charge; wait for receipt view.
  });
  await step('verify receipt total', async () => {
    // TODO: assert receipt shows $25.00 (SALE_TOTAL_CENTS).
  });
}

await posSteps();

result.success = result.errorCount === 0 && result.steps.every(s => s.ok);
result.totalMs = result.steps.reduce((a, s) => a + s.ms, 0);
result.finishedAt = new Date().toISOString();
result.lens2 = {
  taskSuccess: result.success,
  steps: result.steps.length,
  timeMs: result.totalMs,
  errorCount: result.errorCount + result.consoleErrors.length + result.pageErrors.length,
  seq: null, // collected from the human tester post-run
};
writeFileSync(join(OUT, 'w3-ui-result.json'), JSON.stringify(result, null, 2));
console.log(`W3 UI run: success=${result.success} steps=${result.steps.length} ${result.totalMs}ms errors=${result.lens2.errorCount}`);
console.log(`→ ${join(OUT, 'w3-ui-result.json')}`);
await browser.close();
process.exit(result.success ? 0 : 1);
