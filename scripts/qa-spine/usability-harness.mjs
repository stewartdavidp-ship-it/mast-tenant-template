#!/usr/bin/env node
/**
 * QA Spine — USABILITY HARNESS (Lens 2, HUMAN side): objective-metrics capture.
 * NOT a migration script. Extends the w3-pos-ui.mjs step-runner to the top
 * money/critical flows of the spine and records the OBJECTIVE half of the
 * human ease-of-use measurement — per-task success, time-on-task, #steps/clicks,
 * error count — automatically. The SUBJECTIVE half (SUS + SEQ) is collected from
 * a real human tester via docs/ux-audit/qa-spine/usability-runbook.md and is
 * LEFT NULL here BY DESIGN — this harness never invents a human number.
 *
 * Six tasks (top money/critical flows from the spine):
 *   T1 (W1) List a product for sale           — writable tenant
 *   T2 (W2) Fulfill an online order → delivered — writable tenant
 *   T3 (W3) Ring a POS sale → books            — writable tenant
 *   T4 (W6) Read the financial truth           — READ-ONLY (runnable on an authed read session)
 *   T5 (W4) Restock from low inventory (PO)    — writable tenant
 *   T6 (W9) Find a customer cohort / wholesale — READ-ONLY
 *
 * Each task carries a single success criterion (from its W-spec Steps). For the
 * money/read tasks the success oracle is AUTOMATED: the harness compares the
 * rendered UI figure against an MCP oracle payload (the money-canary pattern), so
 * task-success is decided objectively, not by human judgement. The live oracle
 * baseline below was captured from golden-auric on 2026-06-22 (read-only mast-mcp);
 * supply fresh payloads via the *_JSON envs to re-baseline.
 *
 * Constraint (same as the S-2 write-delta canary — do NOT rebuild that): the WRITE
 * tasks (T1/T2/T3/T5) need a WRITABLE authed Playwright storageState; `?testmode=1`
 * is write-denied. The READ tasks (T4/T6) run on any authed read session. Where a
 * write needs the operator-gated writable tenant, the task records
 * status:"needs-writable-tenant" rather than a fabricated pass.
 *
 * Env:
 *   MAST_BASE_URL      (required) e.g. https://<tenant>.<host> — no default (keeps the
 *                      hardcoded-host lint clean; supply per-run)
 *   MAST_STORAGE_STATE (required for writes; recommended for reads) authed storageState.json
 *   MAST_TENANT        (record-keeping, default "")
 *   TASKS              comma list to run a subset, e.g. "T4,T6" (default all)
 *   MONEY_REVENUE_JSON (optional) finance_get_revenue payload → T4 success oracle
 *   MONEY_PNL_JSON     (optional) finance_get_pnl payload     → T4 success oracle
 *   OUT_DIR            output dir (default ./qa-spine-out)
 *   HEADLESS           "0" to watch (default headless)
 *
 * Usage:
 *   node scripts/qa-spine/usability-harness.mjs --plan          # print the task plan + scorecard skeleton (no browser)
 *   MAST_BASE_URL=… MAST_STORAGE_STATE=… node scripts/qa-spine/usability-harness.mjs
 *   MAST_BASE_URL=… MAST_STORAGE_STATE=… TASKS=T4,T6 node scripts/qa-spine/usability-harness.mjs   # read-only subset
 *
 * Exit 0 = all attempted tasks succeeded (objective); 1 = an objective failure or
 * a needs-writable-tenant skip; 2 = bad invocation. The subjective SUS/SEQ are out
 * of scope for the exit code — they are a human deliverable.
 */
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const PLAN_ONLY = process.argv.includes('--plan');
const BASE = process.env.MAST_BASE_URL;
const STORAGE = process.env.MAST_STORAGE_STATE || undefined;
const TENANT = process.env.MAST_TENANT || '';
const ONLY = (process.env.TASKS || '').split(',').map((s) => s.trim()).filter(Boolean);
const OUT = process.env.OUT_DIR || 'qa-spine-out';
const HEADLESS = process.env.HEADLESS !== '0';

// Live oracle baseline (read-only mast-mcp, tenant golden-auric, 2026-06-22). Used to
// judge the READ tasks objectively. Override with MONEY_*_JSON for a fresh window/tenant.
const ORACLE_BASELINE = {
  tenant: 'golden-auric',
  capturedAt: '2026-06-22',
  window: { start: '2025-10-01', end: '2026-06-30' },
  revenue: { total: 3787391, byChannel: { dtc_online: 1661398, in_person: 1616993, wholesale: 509000 } },
  pnl: { revenue: 3787391, marginReliable: false, cogsLineMissingCount: 10 },
};
const loadJson = (p) => (p ? JSON.parse(readFileSync(p, 'utf8')) : null);
const oracleRevenue = loadJson(process.env.MONEY_REVENUE_JSON) || ORACLE_BASELINE.revenue;
const oraclePnl = loadJson(process.env.MONEY_PNL_JSON) || ORACLE_BASELINE.pnl;
const dollars = (c) => '$' + (Number(c) / 100).toFixed(2);

/**
 * The six tasks. `steps` are user intents (one row = one thing the human does);
 * SELECTORS are marked TODO to fill from the live authed DOM on the first run (the
 * admin DOM can't be read in `?testmode=1`, which is write-denied) — exactly the
 * honest convention of w3-pos-ui.mjs. `idealSteps` is the canonical UI-path length
 * from the W-spec (the objective baseline); `actualSteps` is captured on run.
 * `mutates` flags the write tasks that need the operator-gated writable tenant.
 */
const TASKS = [
  {
    id: 'T1', workflow: 'W1', title: 'List a product for sale', mutates: true,
    success: 'The product is purchasable on the storefront with the correct price and variant set.',
    uiPath: 'materials → recipe builder → product editor (variants, price) → publish gate → storefront product page',
    idealSteps: 7,
    steps: [
      ['open products', async (p) => { await p.goto(`${BASE}/app/#products-v2`, { waitUntil: 'networkidle' }); }],
      ['start new product', async () => { throw todo('click "+ New product"'); }],
      ['set name + price-from-cost', async () => { throw todo('fill name; set price from target margin'); }],
      ['add 2 variants', async () => { throw todo('add a size/option dimension → 2 variants'); }],
      ['set initial inventory', async () => { throw todo('set stock for a strict/in-stock type'); }],
      ['publish', async () => { throw todo('pass the readiness gate → publish'); }],
      ['verify on storefront', async () => { throw todo('open the storefront product page; assert price + variants'); }],
    ],
  },
  {
    id: 'T2', workflow: 'W2', title: 'Fulfill an online order → delivered', mutates: true,
    success: 'The order reaches complete; inventory is decremented; revenue reflects the order total once.',
    uiPath: 'orders-v2 triage → (build job if MTO) → fulfillment pack/ship (tracking) → complete',
    idealSteps: 8,
    steps: [
      ['open orders', async (p) => { await p.goto(`${BASE}/app/#orders-v2`, { waitUntil: 'networkidle' }); }],
      ['open the target order', async () => { throw todo('open a placed storefront order'); }],
      ['triage / accept', async () => { throw todo('accept/confirm the order'); }],
      ['mark built (if MTO)', async () => { throw todo('create/complete a build job if made-to-order'); }],
      ['pack', async () => { throw todo('pack the order'); }],
      ['ship + capture tracking', async () => { throw todo('ship; enter tracking'); }],
      ['mark complete', async () => { throw todo('advance to complete/delivered'); }],
      ['verify inventory + revenue', async () => { throw todo('confirm inventory −N and revenue += total (oracle)'); }],
    ],
  },
  {
    id: 'T3', workflow: 'W3', title: 'Ring a POS sale → books', mutates: true,
    success: 'Receipt shows the exact total; revenue increases by exactly that amount once; inventory −1.',
    uiPath: '#pos → Open POS checkout (new tab) → find product → Charge → Cash → Complete Sale → receipt',
    idealSteps: 6,
    steps: [
      ['open POS', async (p) => { await p.goto(`${BASE}/app/#pos`, { waitUntil: 'networkidle' }); }],
      ['open POS checkout (new tab)', async () => { throw todo('click "Open POS checkout ↗" (opens /pos/ in a new tab)'); }],
      ['find + add product', async () => { throw todo('search the fixture product; add to cart'); }],
      ['charge → cash', async () => { throw todo('Charge → select Cash → exact amount'); }],
      ['complete sale', async () => { throw todo('Complete Sale; wait for "Sale Recorded!"'); }],
      ['verify receipt + books', async () => { throw todo('assert receipt total; revenue +exact once; inventory −1 (oracle)'); }],
    ],
  },
  {
    id: 'T4', workflow: 'W6', title: 'Read the financial truth', mutates: false,
    success: 'Reach the correct revenue + P&L; recognize when gross/net margin is withheld (COGS incomplete).',
    uiPath: 'finance-pl-v2 hub → revenue card + P&L pane',
    idealSteps: 3,
    steps: [
      ['open finance P&L hub', async (p) => { await p.goto(`${BASE}/app/#finance-pl-v2`, { waitUntil: 'networkidle' }); }],
      ['read revenue', async (p, t) => {
        // Prefer the UI's OWN computed figure over scraping pixels (FinanceBridge),
        // mirroring money-canary.mjs. TODO(first authed run): confirm the accessor.
        t.uiRevenueCents = await p.evaluate(async () => {
          try {
            const B = window.FinanceBridge;
            if (B && typeof B.loadRevenueAggregate === 'function') {
              const r = await B.loadRevenueAggregate('2025-10-01', '2026-06-30');
              return (r && (r.totalCents ?? r.total)) ?? null;
            }
          } catch { /* fall through */ }
          return null;
        });
      }],
      ['read margin gate', async (p, t) => {
        t.uiMarginWithheld = await p.evaluate(() => /Margin withheld|COGS incomplete/i.test(document.body.innerText || ''));
      }],
    ],
    // Automated success oracle (objective): UI revenue == MCP revenue, AND the UI
    // withholds margin IFF the MCP says marginReliable:false.
    oracle: (t) => {
      const checks = [];
      if (t.uiRevenueCents != null) {
        checks.push({ name: 'UI revenue == MCP revenue', pass: Number(t.uiRevenueCents) === Number(oracleRevenue.total), detail: dollars(oracleRevenue.total) });
      } else {
        checks.push({ name: 'UI revenue read', pass: false, detail: 'could not read FinanceBridge — fill the accessor/scrape selector' });
      }
      checks.push({ name: 'UI margin-withheld == MCP !marginReliable', pass: !!t.uiMarginWithheld === !oraclePnl.marginReliable, detail: oraclePnl.marginReliable ? 'expect shown' : 'expect withheld' });
      return checks;
    },
  },
  {
    id: 'T5', workflow: 'W4', title: 'Restock from low inventory (PO)', mutates: true,
    success: 'A PO goes draft→sent→received; inventory increases by the received qty; cost basis updates.',
    uiPath: 'reorder-v2 (needs-reorder) → procurement-v2 draft PO → send → receive → inventory/cost-basis',
    idealSteps: 6,
    steps: [
      ['open reorder queue', async (p) => { await p.goto(`${BASE}/app/#reorder-v2`, { waitUntil: 'networkidle' }); }],
      ['generate a draft PO', async () => { throw todo('select a needs-reorder item → generate draft PO'); }],
      ['review / adjust lines', async () => { throw todo('open the PO in procurement-v2; adjust a line qty/cost'); }],
      ['send to vendor', async () => { throw todo('advance draft → sent'); }],
      ['receive (full/partial)', async () => { throw todo('receive the goods'); }],
      ['verify inventory + cost basis', async () => { throw todo('confirm on-hand += received; cost basis updated (materials_cost_history)'); }],
    ],
  },
  {
    id: 'T6', workflow: 'W9', title: 'Find a customer cohort / manage wholesale', mutates: false,
    success: 'A segment filter returns the correct cohort; the wholesale account resolves the right pricing tier.',
    uiPath: 'customers-v2 → apply a saved segment / Wholesale filter → open an account',
    idealSteps: 5,
    steps: [
      ['open customers', async (p) => { await p.goto(`${BASE}/app/#customers-v2`, { waitUntil: 'networkidle' }); }],
      ['read list size', async (p, t) => { t.uiListCount = await p.evaluate(() => document.querySelectorAll('[data-customer-row],[data-row="customer"]').length || null); }],
      ['apply Wholesale filter', async () => { throw todo('click the Wholesale filter chip'); }],
      ['apply a saved segment', async () => { throw todo('select a saved segment; note the returned cohort size'); }],
      ['open an account', async () => { throw todo('open a wholesale account; confirm its pricing tier resolves'); }],
    ],
  },
];

function todo(msg) { const e = new Error(`TODO: ${msg} (fill from live authed DOM)`); e.isTodo = true; return e; }

// ── plan mode: print the task plan + the objective scorecard skeleton, no browser ──
function emitPlan() {
  const plan = {
    harness: 'usability-harness', generatedAt: new Date().toISOString(),
    note: 'Objective half is auto-captured on run; SUS + SEQ are HUMAN — see usability-runbook.md. No values are fabricated.',
    oracleBaseline: ORACLE_BASELINE,
    tasks: TASKS.map((t) => ({
      id: t.id, workflow: t.workflow, title: t.title, mutates: t.mutates,
      runnableNow: t.mutates ? 'needs-writable-tenant (operator-gated; same as S-2)' : 'read-only — runnable on an authed read session',
      success: t.success, uiPath: t.uiPath, idealSteps: t.idealSteps,
      lens2: { taskSuccess: null, steps: null, clicks: null, timeMs: null, errorCount: null, seq: null, status: 'awaiting-run' },
    })),
    suiteSus: { score: null, status: 'awaiting-human-run', instrument: 'SUS 10-item, 0–100 (avg 68; good 80+)' },
  };
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, 'usability-plan.json'), JSON.stringify(plan, null, 2));
  console.log('USABILITY HARNESS — task plan (objective half auto; SUS/SEQ are human)\n');
  for (const t of plan.tasks) console.log(`  ${t.id} (${t.workflow}) ${t.title}\n       success: ${t.success}\n       run:     ${t.runnableNow}  · idealSteps ${t.idealSteps}`);
  console.log(`\n→ ${join(OUT, 'usability-plan.json')}  ·  SUS/SEQ awaiting human run (usability-runbook.md)`);
}

async function runTask(page, t) {
  const rec = { id: t.id, workflow: t.workflow, title: t.title, mutates: t.mutates,
    success: t.success, status: 'run', steps: [], clicks: 0, errorCount: 0, oracleChecks: [], scratch: {} };
  let idx = 0;
  for (const [name, fn] of t.steps) {
    const t0 = Date.now();
    const s = { i: ++idx, name, ok: false, ms: 0, error: null, shot: null };
    try { await fn(page, rec.scratch); s.ok = true; }
    catch (e) { s.error = String(e?.message || e); if (e?.isTodo) rec.status = 'incomplete-selectors'; else rec.errorCount++; }
    finally {
      s.ms = Date.now() - t0;
      try { s.shot = join(OUT, `usability-${t.id}-${String(s.i).padStart(2, '0')}.png`); await page.screenshot({ path: s.shot }); } catch {}
      rec.steps.push(s);
    }
  }
  if (t.oracle) { rec.oracleChecks = t.oracle(rec.scratch); }
  const oracleOk = rec.oracleChecks.length ? rec.oracleChecks.every((c) => c.pass) : null;
  const allStepsOk = rec.steps.every((s) => s.ok);
  rec.lens2 = {
    taskSuccess: rec.status === 'incomplete-selectors' ? null : (oracleOk != null ? oracleOk && allStepsOk : allStepsOk && rec.errorCount === 0),
    steps: rec.steps.length, idealSteps: t.idealSteps, clicks: rec.clicks || null,
    timeMs: rec.steps.reduce((a, s) => a + s.ms, 0), errorCount: rec.errorCount,
    seq: null, // ← HUMAN: collected post-task via the runbook. Never auto-filled.
    status: rec.status === 'incomplete-selectors' ? 'awaiting-selectors'
      : (t.mutates && !STORAGE ? 'needs-writable-tenant' : 'objective-captured'),
  };
  delete rec.scratch;
  return rec;
}

async function main() {
  if (PLAN_ONLY) return emitPlan();
  if (!BASE) { console.error('MAST_BASE_URL is required (e.g. https://<tenant>.<host>). Use --plan for a no-browser dry run.'); process.exit(2); }
  mkdirSync(OUT, { recursive: true });
  const tasks = ONLY.length ? TASKS.filter((t) => ONLY.includes(t.id)) : TASKS;

  let chromium;
  try { ({ chromium } = await import('playwright')); }
  catch { console.error('playwright not installed — run `npm ci` in scripts/ (see W3-pilot.md §6). Use --plan for a no-browser dry run.'); process.exit(2); }

  const browser = await chromium.launch({ headless: HEADLESS });
  const context = await browser.newContext(STORAGE ? { storageState: STORAGE } : {});
  const page = await context.newPage();
  const consoleErrors = []; const pageErrors = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => pageErrors.push(String(e)));

  // Stale-bundle guard (memory: hash-nav serves a cached module bundle).
  await page.goto(BASE, { waitUntil: 'networkidle' });
  try { await page.waitForFunction(() => !!window.MAST_MODULES_V, { timeout: 15000 }); } catch {}

  const results = [];
  for (const t of tasks) {
    if (t.mutates && !STORAGE) {
      console.log(`• ${t.id} (${t.workflow}) ${t.title} — SKIP: needs-writable-tenant (no MAST_STORAGE_STATE)`);
      results.push({ id: t.id, workflow: t.workflow, title: t.title, mutates: true,
        lens2: { taskSuccess: null, steps: null, idealSteps: t.idealSteps, clicks: null, timeMs: null, errorCount: null, seq: null, status: 'needs-writable-tenant' } });
      continue;
    }
    const rec = await runTask(page, t);
    rec.lens2.errorCount += 0; // page/console errors rolled into the suite below
    console.log(`• ${rec.id} (${rec.workflow}) ${rec.title} — success=${rec.lens2.taskSuccess} steps=${rec.lens2.steps}/${t.idealSteps} ${rec.lens2.timeMs}ms err=${rec.lens2.errorCount} [${rec.lens2.status}]`);
    results.push(rec);
    writeFileSync(join(OUT, `usability-${rec.id}.json`), JSON.stringify(rec, null, 2));
  }
  await browser.close();

  const suite = {
    harness: 'usability-harness', tenant: TENANT, baseUrl: BASE, finishedAt: new Date().toISOString(),
    consoleErrors, pageErrors,
    tasks: results.map((r) => ({ id: r.id, workflow: r.workflow, title: r.title, lens2: r.lens2 })),
    sus: { score: null, status: 'awaiting-human-run', instrument: 'SUS 10-item, 0–100 (avg 68; good 80+)', note: 'Collect via usability-runbook.md; do NOT auto-fill.' },
    anchors: { taskCompletion: '>=78%', seqAvg: '~5.5 (aim >=5.5)', susAvg: 68, susGood: 80 },
  };
  writeFileSync(join(OUT, 'usability-suite.json'), JSON.stringify(suite, null, 2));
  console.log(`\n→ ${join(OUT, 'usability-suite.json')}  ·  SUS/SEQ awaiting human run (usability-runbook.md)`);

  const attempted = results.filter((r) => r.lens2.status === 'objective-captured');
  const objectiveFail = attempted.some((r) => r.lens2.taskSuccess === false);
  const blocked = results.some((r) => ['needs-writable-tenant', 'awaiting-selectors'].includes(r.lens2.status));
  process.exit(objectiveFail || blocked ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
