#!/usr/bin/env node
/**
 * QA Spine — capture the ONE credential for the unattended write-delta runner.
 *
 * The write-delta runner's oracle (finance + inventory) is admin-gated. The ONLY
 * irreducible operator step is minting an authed admin session for the QA tenant
 * and handing it to CI as a single secret. This helper does the minting: it opens
 * a real browser, you log into the QA tenant's admin ONCE, and it dumps a
 * Playwright storageState (INCLUDING IndexedDB, where Firebase compat stores the
 * auth refresh token) and prints the base64 to paste into the GitHub secret
 * MAST_QA_STORAGE_STATE.
 *
 * Because Firebase persists auth in IndexedDB (not localStorage), this needs
 * Playwright ≥ 1.51 (storageState `indexedDB:true`). The nightly workflow installs
 * that version; install it locally the same way to capture:
 *     npm i -D playwright@^1.51 && npx playwright install chromium
 *
 * Usage (operator, ONE time — and again only if the session is ever revoked):
 *     MAST_BASE_URL=https://<qa-tenant>.runmast.com \
 *       node scripts/qa-spine/capture-qa-storage-state.mjs
 *   → a browser opens; log into the admin; once you're in, it captures and prints:
 *       MAST_QA_STORAGE_STATE (base64) — set this as a GitHub Actions secret.
 *
 * The refresh token inside is long-lived under nightly use; re-run this only if a
 * run reports "oracle not authenticated" (session revoked / password changed).
 */
import { writeFileSync, readFileSync } from 'node:fs';

const BASE = process.env.MAST_BASE_URL;
const OUT = process.env.OUT || 'qa-storage-state.json';
const TIMEOUT_MIN = Number(process.env.LOGIN_TIMEOUT_MIN || 5);
if (!BASE) { console.error('MAST_BASE_URL is required (e.g. https://<qa-tenant>.runmast.com)'); process.exit(2); }

let chromium;
try { ({ chromium } = await import('playwright')); }
catch { console.error('playwright not installed — `npm i -D playwright@^1.51 && npx playwright install chromium`'); process.exit(2); }

console.log(`\n══ capture QA storage state @ ${BASE} ══`);
console.log('A browser will open. Log into the admin (email/password or Google).');
console.log(`Waiting up to ${TIMEOUT_MIN} min for an authenticated NON-anonymous admin session…\n`);

const browser = await chromium.launch({ headless: false });
const context = await browser.newContext();
const page = await context.newPage();
await page.goto(`${BASE}/app/`, { waitUntil: 'domcontentloaded' });

const deadline = Date.now() + TIMEOUT_MIN * 60 * 1000;
let uid = null;
while (Date.now() < deadline) {
  uid = await page.evaluate(() => {
    try { const u = (window.firebase && firebase.auth) ? firebase.auth().currentUser : null; return u && !u.isAnonymous ? u.uid : null; }
    catch { return null; }
  }).catch(() => null);
  if (uid) break;
  await page.waitForTimeout(2000);
}

if (!uid) {
  console.error('\n✗ no authenticated admin session detected before timeout. Re-run and complete the login.');
  await browser.close();
  process.exit(1);
}

console.log(`\n✔ authenticated as admin uid=${uid}. Capturing storageState (with IndexedDB)…`);
try {
  await context.storageState({ path: OUT, indexedDB: true });
} catch (e) {
  console.error('\n✗ storageState(indexedDB:true) failed — you likely have Playwright < 1.51.');
  console.error('   Firebase auth lives in IndexedDB; without it the captured state will NOT carry the session.');
  console.error('   Upgrade: npm i -D playwright@^1.51 && npx playwright install chromium\n   Detail:', e.message);
  await browser.close();
  process.exit(1);
}
await browser.close();

const b64 = Buffer.from(readFileSync(OUT, 'utf8'), 'utf8').toString('base64');
writeFileSync(OUT + '.b64', b64);
console.log(`\n✔ wrote ${OUT} (raw) and ${OUT}.b64 (base64).`);
console.log('\n─────────────────────────────────────────────────────────────────────────────');
console.log('Set this as the GitHub Actions secret  MAST_QA_STORAGE_STATE  (Settings → Secrets');
console.log('→ Actions → New repository secret). Value = the contents of ' + OUT + '.b64, e.g.:');
console.log('\n  gh secret set MAST_QA_STORAGE_STATE < ' + OUT + '.b64\n');
console.log('Then delete the local files (they contain a live session):  rm ' + OUT + ' ' + OUT + '.b64');
console.log('─────────────────────────────────────────────────────────────────────────────');
console.log(`(base64 is ${b64.length} chars; uid=${uid})`);
