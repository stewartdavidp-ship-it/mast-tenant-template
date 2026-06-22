#!/usr/bin/env node
/**
 * QA Spine — WRITE-DELTA sale DRIVER (Playwright). The piece-2 sale-writer for the
 * write-delta money canary (write-delta-canary.mjs). Generalizes the step-runner +
 * metric capture from w3-pos-ui.mjs to drive a REAL sale on either surface:
 *
 *   --surface storefront  (default) → the public storefront submitOrder path: any
 *      visitor (guest/anonymous — checkout.js signs in anonymously, no admin, no
 *      stored auth) drives product → add-to-cart → checkout → place-order. This is
 *      the cleanest REAL write (mission: "any signed-in visitor can drive it"),
 *      channel = dtc_online.
 *   --surface pos → the admin POS register (needs a WRITABLE admin storageState).
 *      channel = in_person. (The original W3 path; see W3-pilot.md §3b.)
 *
 * ⚠️ THE IRREVERSIBLE WRITE is the place-order click → callFunction('submitOrder')
 * (checkout.js:2094). With --dry-run the driver walks the WHOLE flow but STOPS
 * right before that click — so the selectors validate against ANY live storefront
 * (e.g. golden-auric, read-only) with zero side effects. Without --dry-run it
 * completes the sale (on a demo clone the demo envelope forces Square TEST mode;
 * a wallet/$0 path is an alternative — see W3b doc).
 *
 * The AGENT brackets this with the MCP oracle (finance_get_revenue / _pnl /
 * mast_products) BEFORE and AFTER, then runs write-delta-canary.mjs `assert`.
 *
 * Env (flags override):
 *   MAST_BASE_URL      (required) e.g. https://<clone>.runmast.com  (no default → hardcoded-host lint clean)
 *   FIXTURE_PID        product to sell (default qa-write-canary; use a real in-stock pid for dry-run validation)
 *   SALE_QTY           default 1
 *   SURFACE            storefront | pos   (default storefront)
 *   DRY_RUN            "1" → stop before the irreversible submit (default off)
 *   MAST_STORAGE_STATE Playwright storageState.json (REQUIRED only for --surface pos)
 *   OUT_DIR            default ./qa-spine-out
 *   HEADLESS           "0" to watch (default headless)
 *
 * Usage:
 *   # Validate storefront selectors against a live tenant, NO write:
 *   MAST_BASE_URL=https://golden-auric.runmast.com FIXTURE_PID=ao-crescent-ear-climbers \
 *     DRY_RUN=1 node scripts/qa-spine/write-delta-sale.mjs
 *   # Drive the real sale on an operator-minted writable clone:
 *   MAST_BASE_URL=https://<clone>.runmast.com FIXTURE_PID=qa-write-canary \
 *     node scripts/qa-spine/write-delta-sale.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.env.MAST_BASE_URL;
const FIXTURE_PID = process.env.FIXTURE_PID || 'qa-write-canary';
const SALE_QTY = Number(process.env.SALE_QTY || 1);
const SURFACE = (process.env.SURFACE || 'storefront').toLowerCase();
const DRY_RUN = process.env.DRY_RUN === '1';
const STORAGE = process.env.MAST_STORAGE_STATE || undefined;
const OUT = process.env.OUT_DIR || 'qa-spine-out';
const HEADLESS = process.env.HEADLESS !== '0';

if (!BASE) { console.error('MAST_BASE_URL is required (e.g. https://<tenant>.runmast.com)'); process.exit(2); }
if (SURFACE === 'pos' && !STORAGE) { console.error('--surface pos needs MAST_STORAGE_STATE (an authed admin session).'); process.exit(2); }
mkdirSync(OUT, { recursive: true });

const result = {
  probe: 'write-delta-sale', surface: SURFACE, fixturePid: FIXTURE_PID, qty: SALE_QTY,
  dryRun: DRY_RUN, baseUrl: BASE, startedAt: new Date().toISOString(),
  steps: [], consoleErrors: [], pageErrors: [], submitObserved: null,
  totalMs: 0, errorCount: 0, success: false,
};

const browser = await chromium.launch({ headless: HEADLESS });
const context = await browser.newContext(STORAGE ? { storageState: STORAGE } : {});
const page = await context.newPage();
page.on('console', (m) => { if (m.type() === 'error') result.consoleErrors.push(m.text()); });
page.on('pageerror', (e) => result.pageErrors.push(String(e)));
// Observe the irreversible call without depending on UI text: submitOrder is a
// Firebase callable (POST .../submitOrder). Record if we ever see it fire.
page.on('request', (r) => { if (/submitOrder/i.test(r.url())) result.submitObserved = { url: r.url(), at: new Date().toISOString() }; });

let idx = 0;
async function step(name, fn) {
  const t0 = Date.now();
  const rec = { i: ++idx, name, ok: false, ms: 0, error: null, note: null, shot: null };
  try { rec.note = await fn(); rec.ok = true; }
  catch (e) { rec.error = String(e?.message || e); result.errorCount++; }
  finally {
    rec.ms = Date.now() - t0;
    try { rec.shot = join(OUT, `wd-${SURFACE}-${String(rec.i).padStart(2, '0')}-${name.replace(/\W+/g, '_')}.png`); await page.screenshot({ path: rec.shot }); } catch {}
    result.steps.push(rec);
    console.log(`  ${rec.ok ? '✔' : '✗'} ${name}${rec.note ? ' — ' + rec.note : ''}${rec.error ? ' — ' + rec.error : ''} (${rec.ms}ms)`);
  }
  return rec.ok;
}
// first matching selector from a list (resilience against minor DOM drift)
async function firstVisible(selectors, timeout = 8000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    for (const s of selectors) {
      const el = page.locator(s).first();
      if (await el.count() && await el.isVisible().catch(() => false)) return s;
    }
    await page.waitForTimeout(200);
  }
  return null;
}

// ── STOREFRONT: product → add-to-cart → cart drawer → checkout steps → place-order
async function storefrontSteps() {
  await step('load storefront', async () => {
    // domcontentloaded only — networkidle never settles (Unsplash imagery + the CF
    // insights beacon keep the network busy; it cost 44s with no added signal).
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    const title = await page.title();
    return `title="${title}"`;
  });
  await step('open product page', async () => {
    // product.html accepts ?id= AND ?pid= (storefront map).
    await page.goto(`${BASE}/product.html?id=${encodeURIComponent(FIXTURE_PID)}`, { waitUntil: 'domcontentloaded' });
    const sel = await firstVisible(['#addToCartBtn', 'button:has-text("Add to Cart")', '[data-action="add-to-cart"]'], 12000);
    if (!sel) throw new Error('product page loaded but no Add-to-Cart control found');
    const disabled = await page.locator(sel).first().isDisabled().catch(() => false);
    return `add-to-cart=${sel}${disabled ? ' (DISABLED — variant product? use a single-SKU fixture)' : ''}`;
  });
  await step('add to cart', async () => {
    const sel = await firstVisible(['#addToCartBtn', 'button:has-text("Add to Cart")', '[data-action="add-to-cart"]']);
    await page.locator(sel).first().click();
    await page.waitForTimeout(800); // toast + cart sync
    return 'clicked add-to-cart';
  });
  await step('open cart drawer', async () => {
    const sel = await firstVisible(['#cartIconWrap', '#cartIconMobile', '#cartDrawer', '[data-action="open-cart"]']);
    if (sel && sel !== '#cartDrawer') await page.locator(sel).first().click();
    const drawer = await firstVisible(['#cartDrawer', '.cart-drawer'], 5000);
    if (!drawer) throw new Error('cart drawer did not open');
    const items = await page.locator('[data-cart-id], .cart-item').count();
    let total = '';
    try { total = (await page.locator('#cartFooterSummary, .cart-footer-summary').first().innerText()).replace(/\s+/g, ' ').trim(); } catch {}
    return `drawer open, items=${items}, summary="${total}"`;
  });
  await step('begin checkout', async () => {
    const sel = await firstVisible(['#cartCheckoutBtn', '.cart-footer-actions button:has-text("Checkout")', 'button:has-text("Checkout")', '[data-co="checkout"]']);
    if (!sel) throw new Error('no Checkout button in cart drawer');
    await page.locator(sel).first().click();
    const addr = await firstVisible(['#coEmail', '#shipName', '#shipAddr1'], 6000);
    return addr ? `checkout open (address field ${addr})` : 'checkout clicked (address fields not detected — verify on first run)';
  });
  await step('fill address → shipping', async () => {
    const fill = async (sel, val) => { const f = await firstVisible([sel], 1500); if (f) await page.fill(sel, val); return !!f; };
    const e = await fill('#coEmail', 'qa-write-canary@example.com');
    await fill('#shipName', 'QA Canary');
    await fill('#shipAddr1', '1 Test Way');
    await fill('#shipCity', 'Portland');
    try { await page.selectOption('#shipState', 'OR'); } catch {}
    await fill('#shipZip', '97201');
    await fill('#shipPhone', '5035551234'); await fill('#coPhone', '5035551234'); // optional phones if present
    const next = await firstVisible(['[data-co="addr-next"]'], 2000);
    if (!next) throw new Error('addr-next (Continue to Shipping) not found');
    await page.locator(next).first().click();
    // The shipping step renders its method/total via computeOrderBreakdown (async).
    // Wait for the NEXT step's signature button before advancing — clicking too
    // early was the race that lost place-order on the first run.
    if (!(await firstVisible(['[data-co="ship-next"]'], 12000))) throw new Error('shipping step did not render');
    return `address filled (email ${e ? 'present' : 'MISSING'}) → shipping step`;
  });
  await step('shipping method → review', async () => {
    // Select an explicit method if the step offers radios (flat-rate auto-selects).
    const radio = page.locator('#cartDrawerBody input[type=radio], .cart-drawer-body input[type=radio]').first();
    if (await radio.count()) await radio.check().catch(() => {});
    await page.waitForTimeout(400);
    const ship = await firstVisible(['[data-co="ship-next"]'], 6000);
    if (!ship) throw new Error('ship-next (Continue to Review) not found');
    await page.locator(ship).first().click();
    if (!(await firstVisible(['[data-co="place-order"]'], 12000))) throw new Error('review step did not render place-order');
    return 'shipping selected → review';
  });
  await step(DRY_RUN ? 'locate place-order (DRY RUN — NOT clicking)' : 'place order (submitOrder)', async () => {
    const place = await firstVisible(['[data-co="place-order"]', 'button:has-text("Place Order")', 'button:has-text("Proceed to Payment")'], 8000);
    if (!place) throw new Error('place-order control not found at review step');
    const label = (await page.locator(place).first().innerText().catch(() => '')).trim();
    if (DRY_RUN) return `FOUND place-order ("${label}") — STOPPED before the irreversible submitOrder write ✔`;
    await page.locator(place).first().click();
    // submitOrder fires here; card flow then redirects to the (test-mode) processor.
    await page.waitForTimeout(4000);
    return `clicked "${label}"; submitOrder ${result.submitObserved ? 'OBSERVED' : 'not yet observed'}; url=${page.url()}`;
  });
}

// ── POS: admin Sales Ledger → Open POS checkout (new tab) → add → Cash → Complete.
//    Selectors per W3-pilot.md §3b; refine on first authed run (testmode read-only).
async function posSteps() {
  await step('load admin', async () => {
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.MAST_MODULES_V, { timeout: 15000 }).catch(() => {});
    return 'admin shell loaded';
  });
  await step('open POS register', async () => {
    await page.goto(`${BASE}/pos/`, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle').catch(() => {});
    return `POS at ${page.url()}`;
  });
  await step('add fixture item', async () => {
    const search = await firstVisible(['input[type="search"]', 'input[placeholder*="earch"]', 'input[placeholder*="can"]'], 8000);
    if (!search) throw new Error('POS search field not found — refine selector on first authed run');
    await page.fill(search, FIXTURE_PID);
    await page.waitForTimeout(800);
    const tile = await firstVisible([`[data-pid="${FIXTURE_PID}"]`, '.product-tile', '.pos-product'], 4000);
    if (tile) await page.locator(tile).first().click();
    return `searched ${FIXTURE_PID}; tile=${tile || 'NOT FOUND'}`;
  });
  await step(DRY_RUN ? 'locate Charge (DRY RUN — NOT charging)' : 'charge → cash → complete', async () => {
    const charge = await firstVisible(['button:has-text("Charge")', '[data-action="charge"]'], 6000);
    if (!charge) throw new Error('Charge control not found');
    if (DRY_RUN) return 'FOUND Charge — STOPPED before the irreversible POS sale ✔';
    await page.locator(charge).first().click();
    const cash = await firstVisible(['button:has-text("Cash")', '[data-tender="cash"]'], 4000);
    if (cash) await page.locator(cash).first().click();
    const complete = await firstVisible(['button:has-text("Complete Sale")', 'button:has-text("Complete")'], 4000);
    if (complete) await page.locator(complete).first().click();
    await page.waitForTimeout(2500);
    return `sale completed; url=${page.url()}`;
  });
}

console.log(`\n══ write-delta sale driver · surface=${SURFACE} · fixture=${FIXTURE_PID} · ${DRY_RUN ? 'DRY-RUN (no write)' : 'LIVE WRITE'} @ ${BASE} ══`);
try { await (SURFACE === 'pos' ? posSteps() : storefrontSteps()); }
catch (e) { result.pageErrors.push('driver: ' + String(e?.message || e)); }

result.totalMs = result.steps.reduce((a, s) => a + s.ms, 0);
result.errorCount += result.consoleErrors.length + result.pageErrors.length;
// "success" = the flow reached its end without errors. For a dry-run, that means
// every step up to (and including) locating place-order succeeded.
result.success = result.steps.length > 0 && result.steps.every((s) => s.ok) && result.pageErrors.length === 0;
result.finishedAt = new Date().toISOString();
result.lens2 = { steps: result.steps.length, timeMs: result.totalMs, errorCount: result.errorCount, taskSuccess: result.success };
const file = join(OUT, `write-delta-sale-${SURFACE}.json`);
writeFileSync(file, JSON.stringify(result, null, 2));
console.log(`\nsale driver: ${result.success ? 'OK' : 'INCOMPLETE'} · steps=${result.steps.length} · ${result.totalMs}ms · errors=${result.errorCount}${DRY_RUN ? ' · DRY-RUN (no write)' : (result.submitObserved ? ' · submitOrder OBSERVED' : '')}`);
console.log(`→ ${file}`);
await browser.close();
process.exit(result.success ? 0 : 1);
