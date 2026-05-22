#!/usr/bin/env node
// capture-modes.js — Playwright-driven screenshot capture for every
// Add-to-Mast module card. Walks the admin app on a seeded tenant, takes
// a 1280×720 PNG of each module's main view, uploads to GCS.
//
// Idea -OtFQf3qmFzy6-yrVsTp (Module-card screenshots).
//
// Usage:
//   # First time: log in to the seeded tenant (saves storageState.json)
//   node capture-modes.js --login
//
//   # Then run the full capture
//   node capture-modes.js
//
//   # Capture a single routeId (useful for iterating)
//   node capture-modes.js --only wholesale
//
//   # Dry run: capture but don't upload
//   node capture-modes.js --dry-run
//
//   # Override the tenant / bucket / output dir via env or flags
//   TENANT_URL=https://sgtest15.runmast.com BUCKET=mast-assets-public node capture-modes.js
//
// Manual hero overrides live in scripts/capture-overrides/modes/{routeId}.png.
// If a file exists there, the auto capture is skipped and the override is
// uploaded instead. Lets the operator hand-curate the 10 Phase A heroes
// without forking the script.

'use strict';

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { Storage } = require('@google-cloud/storage');

const SCRIPT_DIR = __dirname;
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
const DATA_FILE = path.join(REPO_ROOT, 'app/data/mode-module-info.js');
const STORAGE_STATE = path.join(SCRIPT_DIR, '.capture-storage-state.json');
const OVERRIDES_DIR = path.join(SCRIPT_DIR, 'capture-overrides/modes');
const OUTPUT_DIR = path.join(SCRIPT_DIR, '.capture-output');

const TENANT_URL = process.env.TENANT_URL || 'https://sgtest15.runmast.com';
const BUCKET = process.env.BUCKET || 'mast-assets-public';
const CACHE_CONTROL = 'public, max-age=86400, stale-while-revalidate=604800';
const VIEWPORT = { width: 1280, height: 720 };
const SETTLE_MS = 1500;
const NAV_TIMEOUT_MS = 20000;

// CLI flags
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const flagValue = (name) => {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : null;
};
const LOGIN_ONLY = flag('--login');
const DRY_RUN = flag('--dry-run');
const ONLY = flagValue('--only');

// ─── 1. Load the route list from the data file ──────────────────
function loadRoutes() {
  const src = fs.readFileSync(DATA_FILE, 'utf8');
  // Cheap parser — pull every "'routeId': {  ... section: 'sectionKey' ..." entry.
  const re = /'([a-z0-9-]+)':\s*\{[^}]*?section:\s*'([a-z-]+)'/g;
  const routes = [];
  let m;
  while ((m = re.exec(src)) !== null) {
    routes.push({ routeId: m[1], section: m[2] });
  }
  // Filter out the page itself + system-managed routes (matches
  // ALLOWED_MISSING in lint-module-info.js).
  const SKIP = new Set([
    'add-to-mast', 'migration', 'migration-confirm', 'migration-plan',
    'migration-import', 'historical-orders',
  ]);
  return routes.filter((r) => !SKIP.has(r.routeId));
}

// ─── 2. Login helper ────────────────────────────────────────────
async function runLogin() {
  console.log(`Opening ${TENANT_URL}/app/ for manual login. Sign in, then close the browser window when you're done.`);
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ viewport: VIEWPORT });
  const page = await context.newPage();
  await page.goto(`${TENANT_URL}/app/`);
  // Wait for the operator to close the browser themselves.
  await new Promise((resolve) => {
    browser.on('disconnected', resolve);
  });
  // Save storage state before disconnect cleanup.
  try {
    await context.storageState({ path: STORAGE_STATE });
    console.log(`Saved storage state to ${STORAGE_STATE}`);
  } catch (e) {
    console.error(`Could not save storage state — did you close the browser before signing in? (${e.message})`);
    process.exit(1);
  }
}

// ─── 3. Capture run ─────────────────────────────────────────────
async function runCapture() {
  if (!fs.existsSync(STORAGE_STATE)) {
    console.error(`Missing ${STORAGE_STATE}. Run: node capture-modes.js --login`);
    process.exit(1);
  }

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.mkdirSync(OVERRIDES_DIR, { recursive: true });

  let routes = loadRoutes();
  if (ONLY) routes = routes.filter((r) => r.routeId === ONLY);
  if (routes.length === 0) {
    console.error(`No routes to capture${ONLY ? ` (filter: --only ${ONLY})` : ''}`);
    process.exit(1);
  }

  console.log(`Capturing ${routes.length} module${routes.length === 1 ? '' : 's'}` +
              (DRY_RUN ? ' (dry run — no upload)' : ` to gs://${BUCKET}/modes/`));

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: VIEWPORT,
    storageState: STORAGE_STATE,
  });

  const storage = DRY_RUN ? null : new Storage();
  const bucket = DRY_RUN ? null : storage.bucket(BUCKET);

  const results = [];
  for (const { routeId, section } of routes) {
    const overridePath = path.join(OVERRIDES_DIR, `${routeId}.png`);
    const outPath = path.join(OUTPUT_DIR, `${routeId}.png`);
    let source;

    if (fs.existsSync(overridePath)) {
      fs.copyFileSync(overridePath, outPath);
      source = 'override';
    } else {
      const page = await context.newPage();
      try {
        await page.goto(`${TENANT_URL}/app/#${routeId}`, {
          waitUntil: 'networkidle',
          timeout: NAV_TIMEOUT_MS,
        });
        await page.waitForTimeout(SETTLE_MS);
        await page.screenshot({ path: outPath, type: 'png' });
        source = 'capture';
      } catch (e) {
        console.error(`  ✗ ${routeId} (${section}) — ${e.message}`);
        results.push({ routeId, ok: false, error: e.message });
        await page.close();
        continue;
      }
      await page.close();
    }

    if (!DRY_RUN) {
      try {
        await bucket.upload(outPath, {
          destination: `modes/${routeId}.png`,
          contentType: 'image/png',
          metadata: { cacheControl: CACHE_CONTROL },
          resumable: false,
        });
      } catch (e) {
        console.error(`  ✗ ${routeId} — upload failed: ${e.message}`);
        results.push({ routeId, ok: false, error: 'upload: ' + e.message });
        continue;
      }
    }

    console.log(`  ✓ ${routeId.padEnd(22)} (${section.padEnd(18)}) [${source}]`);
    results.push({ routeId, ok: true, source });
  }

  await browser.close();

  const ok = results.filter((r) => r.ok).length;
  const fail = results.length - ok;
  console.log(`\nDone: ${ok} captured, ${fail} failed${DRY_RUN ? ' (dry run)' : ''}`);
  process.exit(fail === 0 ? 0 : 1);
}

// ─── Main ───────────────────────────────────────────────────────
(async () => {
  try {
    if (LOGIN_ONLY) await runLogin();
    else await runCapture();
  } catch (e) {
    console.error(`Unexpected error: ${e.message}`);
    console.error(e.stack);
    process.exit(1);
  }
})();
