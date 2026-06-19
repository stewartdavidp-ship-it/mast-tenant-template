#!/usr/bin/env node
/**
 * smoke-boot.mjs — headless boot + route-navigation smoke (Track 0).
 *
 * The decomposition program (decomposition-master-plan.md Track 0 / §2) needs a
 * runtime safety net: the extraction (T1) and V1-retirement (T6) tracks move and
 * DELETE code, and the failure mode is a route that throws an uncaught exception
 * only when you actually visit it (a ReferenceError from a dangling reference, a
 * TypeError from a removed helper). The static lints can't see that. This boots
 * the real admin shell in headless Chromium, navigates every major surface, and
 * FAILS on any uncaught CODE error.
 *
 * How it boots WITHOUT credentials: index.html has a localhost-only test bypass
 * (`?testmode=1`, index.html ~18192) that injects a non-privileged preview admin
 * and calls enterAuthorizedState. The app loads real Firebase (CDN) but the test
 * user can't read/write Firestore, so every read rejects with a permission error
 * and the app FAIL-OPENS to defaults. Those permission/network rejections are
 * EXPECTED data-access noise (see EXPECTED) — they are NOT code bugs and are
 * filtered out. What survives the filter is a genuine code fault.
 *
 * Browser: in CI, `npx playwright install chromium` installs the build matching the
 * pinned playwright, so chromium.launch() resolves it automatically. Locally (where
 * the cached build may differ) set SMOKE_CHROMIUM=/path/to/chromium to override.
 *
 * Exit 0 = booted to authorized state + every route clean. Exit 1 = boot failed or
 * a real uncaught error fired on some route (printed with the offending route).
 */
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = normalize(join(dirname(fileURLToPath(import.meta.url)), '..'));
const MIME = { '.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon','.webp':'image/webp','.woff2':'font/woff2' };

// EXPECTED test-mode noise (data access only) — filtered from the failure signal.
// Data-access + serving-context noise. The preview user can't touch Firestore
// (permission errors) and the localhost-served shell can't cross-origin-fetch the
// tenant's web.app template manifests (CORS) — both are same-origin/authorized in
// the real app. The CSP-meta warning is a browser quirk. None are code bugs.
const EXPECTED = /Missing or insufficient permissions|permission-denied|PERMISSION_DENIED|FirebaseError|Quota exceeded|Failed to (load resource|fetch)|net::ERR|ERR_ABORTED|does not have permission|invalid-argument|unavailable|blocked by CORS policy|Access-Control-Allow-Origin|Content Security Policy directive|frame-ancestors|ERR_FAILED/i;
const isRealBug = m => m && !EXPECTED.test(m);

// Major surfaces across every domain + the V1-retired routes (must resolve to V2)
// + representative V2 routes. Expand freely — more coverage is strictly better.
const ROUTES = [
  'dashboard','products','inventory','orders','customers','contacts','financials',
  'finance-revenue','finance-expenses','finance-ap','finance-ar','settings','subscription',
  'coupons','promotions','galleries','lookbooks','advisor','marketing-calendar','blog',
  'newsletter','social','campaigns','website','procurement','team','channels','wholesale',
  'commissions','rma','jobs','production','materials','book','trips','studio','students',
  'cs-inbox','cs-tickets','auditlog','migration','commission-terms','products-v2','orders-v2','customers-v2',
  // Shows lifecycle — shows.js (V1) retired (T6); the bare #show* routes now
  // resolve directly to the shows-v2 twin (Find/Apply/Prep/Execute/History).
  'show','show-find','show-apply','show-prep','show-execute','show-history',
];

function fail(msg) { console.error('\n✗ smoke-boot: ' + msg); process.exitCode = 1; }

const server = createServer((req, res) => {
  try {
    let p = decodeURIComponent(req.url.split('?')[0]);
    let fp = normalize(join(ROOT, p));
    if (!fp.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
    if (existsSync(fp) && statSync(fp).isDirectory()) fp = join(fp, 'index.html');
    if (!existsSync(fp)) { res.writeHead(404); return res.end('404'); }
    res.writeHead(200, { 'content-type': MIME[extname(fp)] || 'application/octet-stream' });
    res.end(readFileSync(fp));
  } catch (e) { res.writeHead(500); res.end(String(e)); }
});

await new Promise(r => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
// A tenant whose Firebase config RESOLVES (so the app inits + reaches the test
// bypass) — its DATA is permission-denied for the preview user, which is fine. The
// canonical shared dev tenant is the stable default; override with SMOKE_TENANT.
const tenant = process.env.SMOKE_TENANT || 'sgtest15';
const url = `http://127.0.0.1:${port}/app/index.html?testmode=1&tenant=${tenant}`;

const browser = await chromium.launch({ headless: true, executablePath: process.env.SMOKE_CHROMIUM || undefined });
const page = await browser.newPage();
// Capture BOTH uncaught exceptions (pageerror) AND console.error — the route
// dispatcher wraps module setup/render in try/catch, so a broken route surfaces as
// a logged console.error rather than an uncaught throw. Both are filtered by
// EXPECTED so only genuine code faults remain.
const pageErrors = [];
page.on('pageerror', e => pageErrors.push(e.message));
page.on('console', m => { if (m.type() === 'error') pageErrors.push(m.text()); });

console.log('smoke-boot: booting', url);
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(e => fail('goto failed: ' + e.message));

// Wait for the test bypass to reach authorized state (body gets nav-v2; nav renders).
let booted = false;
try {
  await page.waitForFunction(() => document.body &&
    /nav-v2|dark-mode/.test(document.body.className) &&
    /Dashboard/.test(document.body.innerText || ''), { timeout: 25000 });
  booted = true;
} catch (e) { fail('app did not reach authorized state within 25s (login screen / boot hang?)'); }

if (booted) {
  const bootBugs = pageErrors.filter(isRealBug);
  if (bootBugs.length) fail('uncaught error(s) during boot:\n    ' + bootBugs.join('\n    '));

  const routeBugs = {};
  for (const route of ROUTES) {
    const before = pageErrors.length;
    await page.evaluate(r => window.navigateTo(r), route).catch(e => {
      if (isRealBug(e.message)) (routeBugs[route] ||= []).push('navThrow: ' + e.message);
    });
    await page.waitForTimeout(700);
    const fresh = pageErrors.slice(before).filter(isRealBug);
    if (fresh.length) (routeBugs[route] ||= []).push(...fresh);
  }

  const bad = Object.entries(routeBugs);
  if (bad.length) {
    fail(bad.length + ' route(s) threw an uncaught code error:');
    bad.forEach(([r, errs]) => console.error('    [' + r + '] ' + errs.join(' | ')));
  } else {
    console.log('✓ smoke-boot: booted to authorized state; all ' + ROUTES.length +
      ' routes navigated with zero uncaught code errors.');
  }
}

await browser.close();
server.close();
process.exit(process.exitCode || 0);
