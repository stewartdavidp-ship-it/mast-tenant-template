#!/usr/bin/env node
/**
 * QA Spine — WRITE-DELTA CANARY core (pure assertion engine).
 *
 * The WRITE-side complement to the read-side money canary
 * (test/money-canary.test.js / scripts/qa-spine/money-canary.mjs). The read-side
 * proves the SAME static figure agrees across surfaces. This engine proves a
 * single real SALE moves the books by EXACTLY the sale amount, into EXACTLY one
 * canonical channel, with inventory drawn down by qty, the P&L still reconciled,
 * and ZERO collateral damage (AppWorld-style).
 *
 * This module is PURE: it takes a BEFORE snapshot, an AFTER snapshot, and an
 * EXPECT descriptor, and returns the A1–A5 verdicts. No network, no I/O, no
 * clock, no globals (the caller passes the canonical-channel set in). That makes
 * the whole canary OFFLINE-VALIDATABLE — the live harness (write-delta-canary.mjs)
 * feeds it real MCP-oracle snapshots; the self-test feeds it committed fixtures +
 * negative controls to prove it DISCRIMINATES (GREEN on a clean sale, RED on a
 * 100x / double-count / wrong-channel / collateral-damage / un-reconciled after).
 *
 * SNAPSHOT SHAPE (exactly what the frictionless MCP oracle returns):
 *   {
 *     revenue: { total: <cents>, byChannel: { "<channel>": <cents>, ... } },   // finance_get_revenue
 *     pnl:     { revenue, cogs, grossProfit, operatingExpenses, netProfit,     // finance_get_pnl
 *                marginReliable, cogsLineMissingCount, cogsMissing },
 *     products: { "<pid>": { stockType, totalOnHand, totalAvailable,           // mast_products get .stockInfo
 *                            totalCommitted } , ... },  // fixture + witnesses
 *     orderCount?: <n>            // optional (A5 "exactly one new order"); mast_orders is handshake-gated
 *   }
 *
 * EXPECT:
 *   { deltaCents, channel, fixturePid, qty, inventoryMode? }
 *     inventoryMode: 'decrement' (POS/in_person: totalOnHand -qty) |
 *                    'reserve'   (storefront/dtc_online: totalCommitted +qty, onHand flat until ship).
 *                    Default derived from channel ('in_person' -> decrement, else reserve).
 *   In BOTH modes the channel-agnostic invariant is totalAvailable -qty (A3).
 *
 * Exit: this file is import-only (no top-level run). See write-delta-canary.mjs.
 */
import { createRequire } from 'node:module';

/** Load the canonical channel taxonomy (the SAME byte-shared core both surfaces
 *  aggregate on) so A2 can reject an F1-class non-canonical key live. */
export function getCanonicalChannels() {
  const require = createRequire(import.meta.url);
  require('../../shared/channel-normalization.core.js');
  const MastChannels = globalThis.MastChannels;
  return {
    set: new Set(MastChannels ? MastChannels.CHANNELS : []),
    normalize: MastChannels ? MastChannels.normalize : (s) => s,
  };
}

export const dollars = (cents) => '$' + (Number(cents) / 100).toFixed(2);

/** Per-channel revenue delta over the UNION of before/after keys (missing = 0). */
export function channelDeltas(before, after) {
  const b = (before && before.revenue && before.revenue.byChannel) || {};
  const a = (after && after.revenue && after.revenue.byChannel) || {};
  const keys = new Set([...Object.keys(b), ...Object.keys(a)]);
  const out = {};
  for (const k of keys) out[k] = (Number(a[k]) || 0) - (Number(b[k]) || 0);
  return out;
}

/** Inventory delta for one product across the three stock dimensions. */
export function productDelta(beforeProd, afterProd) {
  const d = (f) => (Number(afterProd && afterProd[f]) || 0) - (Number(beforeProd && beforeProd[f]) || 0);
  return { onHand: d('totalOnHand'), available: d('totalAvailable'), committed: d('totalCommitted') };
}

/**
 * Run the A1–A5 write-delta assertions. Returns { assertions:[…], pass, deltas }.
 * `canon` = { set, normalize } from getCanonicalChannels(). `opts.requireOrderDelta`
 * (default: auto — asserted only if both snapshots carry orderCount).
 */
export function assertWriteDelta(before, after, expect, canon, opts = {}) {
  const assertions = [];
  const add = (name, expected, actual, pass, note) =>
    assertions.push({ name, expected, actual, pass: !!pass, note: note || null });

  const T = Number(expect.deltaCents);
  const C = expect.channel;
  const PID = expect.fixturePid;
  const QTY = Number(expect.qty);
  const mode = expect.inventoryMode || (C === 'in_person' ? 'decrement' : 'reserve');

  const chDeltas = channelDeltas(before, after);
  const revDelta = (Number(after.revenue.total) || 0) - (Number(before.revenue.total) || 0);

  // ── A1 — revenue delta == T EXACTLY (cents). The 100x / POS-double-count class. ──
  add('A1 revenue delta == saleTotal (exact cents)', T, revDelta,
    revDelta === T, dollars(T));

  // ── A2 — EXACTLY ONE canonical channel moved, by T; no other channel changed. ──
  const movedKeys = Object.keys(chDeltas).filter((k) => chDeltas[k] !== 0);
  const onlyExpectedMoved = movedKeys.length === 1 && movedKeys[0] === C;
  add('A2a exactly one channel moved (no leak)',
    `[${C}]`, `[${movedKeys.join(', ')}]`, onlyExpectedMoved,
    onlyExpectedMoved ? null : 'other channels moved — collateral revenue leak');
  add(`A2b channel ${C} moved by exactly saleTotal`, T, chDeltas[C] || 0,
    (chDeltas[C] || 0) === T, dollars(T));
  const canonical = canon && canon.set ? canon.set : new Set();
  add('A2c moved channel is CANONICAL (no F1 fragmentation)', true,
    canonical.has(C) && (movedKeys.length === 0 || movedKeys.every((k) => canonical.has(k))),
    canonical.has(C) && movedKeys.every((k) => canonical.has(k)),
    canonical.has(C) ? 'keys: ' + movedKeys.join(', ') : `${C} is not a canonical channel key`);

  // ── A3 — fixture inventory drawn down by qty. Channel-agnostic invariant =
  //    totalAvailable -qty; plus the mode-specific split (POS decrements onHand,
  //    storefront commits — onHand flat until ship). ──
  const fb = (before.products || {})[PID];
  const fa = (after.products || {})[PID];
  if (!fb || !fa) {
    add('A3 fixture inventory snapshot present', true, false, false,
      `fixture ${PID} missing from ${!fb ? 'before' : 'after'} snapshot`);
  } else {
    const fd = productDelta(fb, fa);
    add('A3a fixture totalAvailable -qty (channel-agnostic)', -QTY, fd.available,
      fd.available === -QTY, `onHand∆=${fd.onHand} committed∆=${fd.committed}`);
    if (mode === 'decrement') {
      add('A3b POS: totalOnHand -qty, committed flat', `onHand ${-QTY}/committed 0`,
        `onHand ${fd.onHand}/committed ${fd.committed}`,
        fd.onHand === -QTY && fd.committed === 0);
    } else {
      add('A3b storefront: totalCommitted +qty, onHand flat (until ship)',
        `committed ${QTY}/onHand 0`, `committed ${fd.committed}/onHand ${fd.onHand}`,
        fd.committed === QTY && fd.onHand === 0);
    }
  }

  // ── A4 — reconciliation still holds AFTER the write (the dual-source contract).
  //    pnl.revenue == revenue.total, and the P&L internal arithmetic ties. ──
  add('A4a after: pnl.revenue == revenue.total', after.revenue.total, after.pnl.revenue,
    after.pnl.revenue === after.revenue.total, dollars(after.revenue.total));
  add('A4b after: grossProfit == revenue - cogs',
    after.pnl.revenue - after.pnl.cogs, after.pnl.grossProfit,
    after.pnl.grossProfit === after.pnl.revenue - after.pnl.cogs);
  add('A4c after: netProfit == grossProfit - operatingExpenses',
    after.pnl.grossProfit - after.pnl.operatingExpenses, after.pnl.netProfit,
    after.pnl.netProfit === after.pnl.grossProfit - after.pnl.operatingExpenses);

  // ── A5 — COLLATERAL: nothing else moved. No other product's stock; no other
  //    channel (covered by A2a); optionally exactly one new order. ──
  const otherPids = Object.keys(after.products || {}).filter((p) => p !== PID);
  const collateralProduct = otherPids.filter((p) => {
    const d = productDelta((before.products || {})[p], (after.products || {})[p]);
    return d.onHand !== 0 || d.available !== 0 || d.committed !== 0;
  });
  add('A5a no other product inventory moved', '[]', `[${collateralProduct.join(', ')}]`,
    collateralProduct.length === 0,
    `${otherPids.length} witness product(s) checked`);

  const wantOrderDelta = opts.requireOrderDelta != null
    ? opts.requireOrderDelta
    : (typeof before.orderCount === 'number' && typeof after.orderCount === 'number');
  if (wantOrderDelta) {
    const od = (Number(after.orderCount) || 0) - (Number(before.orderCount) || 0);
    add('A5b exactly one new order', 1, od, od === 1);
  }

  const pass = assertions.every((a) => a.pass);
  return {
    assertions,
    pass,
    deltas: { revenue: revDelta, byChannel: chDeltas, fixture: fb && fa ? productDelta(fb, fa) : null },
  };
}
