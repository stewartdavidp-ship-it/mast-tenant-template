#!/usr/bin/env node
/**
 * QA Spine — WRITE-DELTA MONEY CANARY (orchestrator).
 *
 * The WRITE-side complement to the read-side money canary (#820). The read-side
 * proves a STATIC figure agrees across surfaces; this drives a REAL sale and
 * asserts the books MOVE by exactly the sale amount, into exactly one canonical
 * channel, with inventory drawn down by qty, the P&L still reconciled, and zero
 * collateral damage (AppWorld-style), repeated k=5 times (pass^k = reliability).
 *
 * ⚠️ PERIODIC / OPERATOR-RUN — NOT A PR GATE. The live run needs a WRITABLE tenant
 * (an operator-minted ephemeral demo clone of golden-auric), is slow, and is
 * non-deterministic. The deterministic backbone is the pure engine in
 * write-delta-core.mjs, exercised offline by `self-test` here (no network).
 *
 * THREE-PIECE HARNESS (mint-less remainder runs autonomously after one gated mint):
 *   1. ORACLE (frictionless MCP reads, run by the AGENT): finance_get_revenue +
 *      finance_get_pnl + mast_products get(fixture + witnesses), BEFORE and AFTER
 *      the sale, saved as JSON. This is the gold-standard oracle (mission: "the
 *      before/after MCP money oracle is frictionless read-only").
 *   2. SALE DRIVER (Playwright, GATED on a writable tenant): write-delta-sale.mjs
 *      drives the real storefront submitOrder (or admin POS). Selectors validated
 *      against golden-auric's LIVE public storefront up to the irreversible write.
 *   3. THIS ORCHESTRATOR: feeds the oracle snapshots through the engine, emits the
 *      UI+oracle scorecard, and rolls k iterations up into pass^k.
 *
 * SUBCOMMANDS:
 *   self-test            Run the engine vs committed fixtures + 6 negative controls
 *                        (no network). Proves the canary DISCRIMINATES. Exit 0 iff
 *                        the clean sale is GREEN and every negative control is RED
 *                        for the RIGHT assertion.
 *   assert               Run the engine on agent-fed before/after snapshots, emit
 *                        one iteration scorecard. Exit 0 (pass) / 1 (divergence).
 *   aggregate            Roll qa-spine-out/write-delta-iter-*.json up into pass^k.
 *
 * `assert` inputs (flags override env):
 *   --before <path>   BEFORE_SNAPSHOT_JSON   (required)
 *   --after  <path>   AFTER_SNAPSHOT_JSON    (required)
 *   --channel <key>   EXPECTED_CHANNEL       (default dtc_online; in_person for POS)
 *   --fixture <pid>   FIXTURE_PID            (default qa-write-canary)
 *   --qty <n>         EXPECTED_QTY           (default 1)
 *   --delta <cents>   EXPECTED_DELTA_CENTS   (default 2500)
 *   --iteration <n>   ITERATION              (default 1; names the output file)
 *   --out <dir>       OUT_DIR                (default ./qa-spine-out)
 *   --lens2 <path>    LENS2_JSON             optional agent-cost capture passthrough
 *                                            { toolCalls, responseBytes, approxTokens, costUsd }
 *
 * Usage:
 *   node scripts/qa-spine/write-delta-canary.mjs self-test
 *   node scripts/qa-spine/write-delta-canary.mjs assert \
 *     --before before-1.json --after after-1.json --channel dtc_online --iteration 1
 *   node scripts/qa-spine/write-delta-canary.mjs aggregate
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { assertWriteDelta, getCanonicalChannels, dollars } from './write-delta-core.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, '..', '..');

// ── minimal arg parsing: first non-flag = subcommand; --k v / --flag; env fallback
const argv = process.argv.slice(2);
const cmd = argv.find((a) => !a.startsWith('--')) || 'self-test';
function flag(name, envName, def) {
  const i = argv.indexOf('--' + name);
  if (i >= 0) return argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true;
  if (envName && process.env[envName] != null) return process.env[envName];
  return def;
}
const OUT = flag('out', 'OUT_DIR', 'qa-spine-out');

const clone = (o) => JSON.parse(JSON.stringify(o));
const CANON = getCanonicalChannels();

function printAssertions(res) {
  for (const a of res.assertions) {
    const mark = a.pass ? '✔' : '✗ FAIL';
    console.log(`  ${mark} ${a.name}: expected=${a.expected} actual=${a.actual}${a.note ? '  (' + a.note + ')' : ''}`);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// self-test — the deterministic, offline proof that the engine DISCRIMINATES.
// ════════════════════════════════════════════════════════════════════════════
function selfTest() {
  const FX = join(REPO, 'test', 'fixtures');
  const before = JSON.parse(readFileSync(join(FX, 'write-delta-canary.before.json'), 'utf8'));
  const goodAfter = JSON.parse(readFileSync(join(FX, 'write-delta-canary.after.json'), 'utf8'));
  const EXPECT = { deltaCents: 2500, channel: 'dtc_online', fixturePid: 'qa-write-canary', qty: 1 };

  console.log('\n══ WRITE-DELTA CANARY · self-test (offline, committed fixtures grounded in golden-auric) ══');
  let allOk = true;

  // 1) The clean sale MUST be fully GREEN.
  console.log('\n[clean sale] expect: ALL PASS (revenue +$25 dtc_online, fixture -1 available, reconciled)');
  const clean = assertWriteDelta(before, goodAfter, EXPECT, CANON);
  printAssertions(clean);
  if (!clean.pass) { console.log('  ✗✗ clean sale did NOT pass — the canary would false-alarm on a real sale'); allOk = false; }
  else console.log('  → GREEN ✔');

  // 2) Each negative control MUST be RED, and RED for the NAMED assertion(s).
  const controls = [
    { name: '100x inflation (cents-as-dollars)', wants: ['A1', 'A2b'],
      tamper: (a) => { a.revenue.total = before.revenue.total + 2500 * 100; a.revenue.byChannel.dtc_online = before.revenue.byChannel.dtc_online + 2500 * 100; a.pnl.revenue = a.revenue.total; a.pnl.grossProfit = a.pnl.revenue - a.pnl.cogs; a.pnl.netProfit = a.pnl.grossProfit - a.pnl.operatingExpenses; } },
    { name: 'POS double-count (counted twice)', wants: ['A1', 'A2b'],
      tamper: (a) => { a.revenue.total = before.revenue.total + 2500 * 2; a.revenue.byChannel.dtc_online = before.revenue.byChannel.dtc_online + 2500 * 2; a.pnl.revenue = a.revenue.total; a.pnl.grossProfit = a.pnl.revenue - a.pnl.cogs; a.pnl.netProfit = a.pnl.grossProfit - a.pnl.operatingExpenses; } },
    { name: 'wrong/non-canonical channel (F1 fragmentation)', wants: ['A2a', 'A2c'],
      tamper: (a) => { a.revenue.byChannel.dtc_online = before.revenue.byChannel.dtc_online; a.revenue.byChannel['Online Store'] = 2500; /* total still +T, but into a fragmented non-canonical key */ } },
    { name: 'no inventory drawdown (F12 class)', wants: ['A3a'],
      tamper: (a) => { a.products['qa-write-canary'] = clone(before.products['qa-write-canary']); } },
    { name: 'collateral damage (another product moved)', wants: ['A5a'],
      tamper: (a) => { a.products['ao-crescent-ear-climbers'].totalAvailable -= 1; a.products['ao-crescent-ear-climbers'].totalOnHand -= 1; } },
    { name: 'reconciliation broken (revenue moved, P&L did not)', wants: ['A4a'],
      tamper: (a) => { a.pnl.revenue = before.pnl.revenue; } },
  ];
  for (const c of controls) {
    const after = clone(goodAfter);
    c.tamper(after);
    const res = assertWriteDelta(before, after, EXPECT, CANON);
    const failedNames = res.assertions.filter((x) => !x.pass).map((x) => x.name);
    const caughtBy = c.wants.filter((w) => failedNames.some((n) => n.startsWith(w)));
    const ok = !res.pass && caughtBy.length === c.wants.length;
    console.log(`\n[neg: ${c.name}] expect: RED via ${c.wants.join('+')}`);
    console.log(`  canary=${res.pass ? 'GREEN ✗ (should be RED!)' : 'RED ✔'}  caught-by: ${failedNames.map((n) => n.split(' ')[0]).join(', ') || '(none)'}`);
    if (!ok) { console.log(`  ✗✗ control not caught for the right reason (wanted ${c.wants.join('+')})`); allOk = false; }
  }

  console.log(`\n══ self-test: ${allOk ? 'PASS — the canary discriminates (clean GREEN, all controls RED for the right reason)' : 'FAIL — see above'} ══`);
  process.exit(allOk ? 0 : 1);
}

// ════════════════════════════════════════════════════════════════════════════
// assert — run the engine on agent-fed before/after snapshots; emit a scorecard.
// ════════════════════════════════════════════════════════════════════════════
function assertCmd() {
  const beforePath = flag('before', 'BEFORE_SNAPSHOT_JSON');
  const afterPath = flag('after', 'AFTER_SNAPSHOT_JSON');
  if (!beforePath || !afterPath) {
    console.error('assert: --before and --after (or BEFORE_SNAPSHOT_JSON / AFTER_SNAPSHOT_JSON) are required.');
    console.error('Each is a JSON snapshot: { revenue:{total,byChannel}, pnl:{...}, products:{pid:{stockType,totalOnHand,totalAvailable,totalCommitted}}, orderCount? }');
    process.exit(2);
  }
  const before = JSON.parse(readFileSync(beforePath, 'utf8'));
  const after = JSON.parse(readFileSync(afterPath, 'utf8'));
  const EXPECT = {
    deltaCents: Number(flag('delta', 'EXPECTED_DELTA_CENTS', 2500)),
    channel: String(flag('channel', 'EXPECTED_CHANNEL', 'dtc_online')),
    fixturePid: String(flag('fixture', 'FIXTURE_PID', 'qa-write-canary')),
    qty: Number(flag('qty', 'EXPECTED_QTY', 1)),
  };
  const iter = Number(flag('iteration', 'ITERATION', 1));
  const lens2Path = flag('lens2', 'LENS2_JSON');
  let lens2 = null;
  if (lens2Path && lens2Path !== true) { try { lens2 = JSON.parse(readFileSync(lens2Path, 'utf8')); } catch { /* optional */ } }

  console.log(`\n══ WRITE-DELTA CANARY · assert · iteration ${iter} · sale ${dollars(EXPECT.deltaCents)} into ${EXPECT.channel} ══`);
  const res = assertWriteDelta(before, after, EXPECT, CANON);
  printAssertions(res);

  mkdirSync(OUT, { recursive: true });
  const result = {
    probe: 'write-delta-canary', iteration: iter, expect: EXPECT,
    startedAt: new Date().toISOString(),
    deltas: res.deltas, assertions: res.assertions, pass: res.pass,
    lens2: lens2 || null,
    oracle: { before, after },
  };
  const file = join(OUT, `write-delta-iter-${String(iter).padStart(2, '0')}.json`);
  writeFileSync(file, JSON.stringify(result, null, 2));
  console.log(`\nwrite-delta iter ${iter}: ${res.pass ? 'PASS — books moved by exactly the sale, one channel, inventory drawn, reconciled, no collateral' : 'FAIL — divergence (a real write bug or a stale cached bundle — re-snapshot after a hard-reload)'}`);
  console.log(`→ ${file}`);
  process.exit(res.pass ? 0 : 1);
}

// ════════════════════════════════════════════════════════════════════════════
// aggregate — roll the k iteration scorecards up into pass^k (the reliability bar).
// ════════════════════════════════════════════════════════════════════════════
function aggregate() {
  let files;
  try { files = readdirSync(OUT).filter((f) => /^write-delta-iter-\d+\.json$/.test(f)).sort(); }
  catch { files = []; }
  if (!files.length) { console.error(`aggregate: no write-delta-iter-*.json in ${OUT}. Run \`assert\` per iteration first.`); process.exit(2); }
  const iters = files.map((f) => JSON.parse(readFileSync(join(OUT, f), 'utf8')));
  const passes = iters.filter((it) => it.pass).length;
  const k = iters.length;
  const passHatK = passes === k;
  const lens2 = iters.map((it) => it.lens2).filter(Boolean);
  const scorecard = {
    probe: 'write-delta-canary', surface: 'oracle+ui', generatedAt: new Date().toISOString(),
    k, passes, passHatK,
    perIteration: iters.map((it) => ({ iteration: it.iteration, pass: it.pass, revenueDelta: it.deltas && it.deltas.revenue, failures: it.assertions.filter((a) => !a.pass).map((a) => a.name.split(' ')[0]) })),
    lens2Agg: lens2.length ? {
      iterations: lens2.length,
      avgToolCalls: Math.round(lens2.reduce((s, l) => s + (l.toolCalls || 0), 0) / lens2.length),
      avgResponseBytes: Math.round(lens2.reduce((s, l) => s + (l.responseBytes || 0), 0) / lens2.length),
      avgApproxTokens: Math.round(lens2.reduce((s, l) => s + (l.approxTokens || 0), 0) / lens2.length),
    } : null,
  };
  mkdirSync(OUT, { recursive: true });
  const file = join(OUT, 'write-delta-passk.json');
  writeFileSync(file, JSON.stringify(scorecard, null, 2));
  console.log(`\n══ WRITE-DELTA CANARY · pass^k ══`);
  console.log(`  k=${k}  passes=${passes}  pass^${k}=${passHatK ? 'PASS ✔ (reliable)' : 'FAIL ✗ (a 90% one-shot is only ~59% at k=5 — reliability is the bar)'}`);
  for (const p of scorecard.perIteration) console.log(`  iter ${p.iteration}: ${p.pass ? 'PASS' : 'FAIL [' + p.failures.join(',') + ']'}  Δrev=${p.revenueDelta}`);
  console.log(`→ ${file}`);
  process.exit(passHatK ? 0 : 1);
}

switch (cmd) {
  case 'self-test': selfTest(); break;
  case 'assert': assertCmd(); break;
  case 'aggregate': aggregate(); break;
  default:
    console.error(`Unknown subcommand "${cmd}". Use: self-test | assert | aggregate`);
    process.exit(2);
}
