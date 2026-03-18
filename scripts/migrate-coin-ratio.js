#!/usr/bin/env node
/**
 * Events Coin Migration: 20:1 → 100:1 ratio
 *
 * Migrates all Events advertising token balances per-tenant.
 * - Token balances multiplied by 5 (100/20 = 5x)
 * - Coins unchanged (they're unconverted currency)
 * - Ad tokensCommitted/tokensRemaining multiplied by 5
 * - totalTokensSpent/totalTokensEarned multiplied by 5
 * - showAdConfig coinToTokenRate updated to 100
 *
 * Usage:
 *   node scripts/migrate-coin-ratio.js --dry-run          # preview changes
 *   node scripts/migrate-coin-ratio.js --tenant dev       # migrate one tenant
 *   node scripts/migrate-coin-ratio.js --apply            # migrate all tenants
 *
 * Requires: gcloud auth (uses access token for Firebase REST API)
 */

const { execSync } = require('child_process');

const DB_URL = 'https://mast-platform-prod-default-rtdb.firebaseio.com';
const MULTIPLIER = 5; // 100/20

// ── Firebase REST helpers ──

function getToken() {
  return execSync('gcloud auth print-access-token --project mast-platform-prod', { encoding: 'utf8' }).trim();
}

async function fbGet(path, token) {
  const res = await fetch(`${DB_URL}/${path}.json?access_token=${token}`);
  if (!res.ok) throw new Error(`GET ${path}: ${res.status} ${await res.text()}`);
  return res.json();
}

async function fbPatch(path, data, token) {
  const res = await fetch(`${DB_URL}/${path}.json?access_token=${token}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  if (!res.ok) throw new Error(`PATCH ${path}: ${res.status} ${await res.text()}`);
  return res.json();
}

// ── Migration logic ──

async function migrateTenant(tenantId, token, dryRun) {
  const log = [];
  const prefix = dryRun ? '[DRY-RUN]' : '[APPLY]';

  console.log(`\n${'='.repeat(60)}`);
  console.log(`${prefix} Tenant: ${tenantId}`);
  console.log('='.repeat(60));

  // 1. Migrate vendor wallets
  const wallets = await fbGet(`${tenantId}/events/vendorWallets`, token);
  if (wallets) {
    for (const [showId, showWallets] of Object.entries(wallets)) {
      for (const [vendorId, wallet] of Object.entries(showWallets)) {
        const before = {
          coins: wallet.coins || 0,
          tokens: wallet.tokens || 0,
          totalTokensSpent: wallet.totalTokensSpent || 0,
          totalTokensEarned: wallet.totalTokensEarned || 0
        };

        // Only migrate if there are token values to change
        if (before.tokens === 0 && before.totalTokensSpent === 0 && before.totalTokensEarned === 0) {
          console.log(`  SKIP wallet ${tenantId}/${showId}/${vendorId} — no token values`);
          continue;
        }

        const after = {
          tokens: before.tokens * MULTIPLIER,
          totalTokensSpent: before.totalTokensSpent * MULTIPLIER,
          totalTokensEarned: before.totalTokensEarned * MULTIPLIER
        };

        console.log(`  WALLET ${showId}/${vendorId}:`);
        console.log(`    coins: ${before.coins} (unchanged)`);
        console.log(`    tokens: ${before.tokens} → ${after.tokens}`);
        console.log(`    totalTokensSpent: ${before.totalTokensSpent} → ${after.totalTokensSpent}`);
        console.log(`    totalTokensEarned: ${before.totalTokensEarned} → ${after.totalTokensEarned}`);

        log.push({ type: 'wallet', tenantId, showId, vendorId, before, after });

        if (!dryRun) {
          await fbPatch(`${tenantId}/events/vendorWallets/${showId}/${vendorId}`, {
            ...after,
            updatedAt: new Date().toISOString()
          }, token);
        }
      }
    }
  } else {
    console.log('  No vendor wallets found.');
  }

  // 2. Migrate ad token values
  const ads = await fbGet(`${tenantId}/events/ads`, token);
  if (ads) {
    for (const [showId, showAds] of Object.entries(ads)) {
      for (const [adId, ad] of Object.entries(showAds)) {
        const committed = ad.tokensCommitted || 0;
        const remaining = ad.tokensRemaining || 0;

        if (committed === 0 && remaining === 0) continue;

        const after = {
          tokensCommitted: committed * MULTIPLIER,
          tokensRemaining: remaining * MULTIPLIER
        };

        console.log(`  AD ${showId}/${adId}: committed ${committed}→${after.tokensCommitted}, remaining ${remaining}→${after.tokensRemaining}`);
        log.push({ type: 'ad', tenantId, showId, adId, before: { committed, remaining }, after });

        if (!dryRun) {
          await fbPatch(`${tenantId}/events/ads/${showId}/${adId}`, {
            ...after,
            updatedAt: new Date().toISOString()
          }, token);
        }
      }
    }
  }

  // 3. Update showAdConfig rates
  const adConfigs = await fbGet(`${tenantId}/events/showAdConfig`, token);
  if (adConfigs) {
    for (const [showId, config] of Object.entries(adConfigs)) {
      const oldRate = config.coinToTokenRate || config.tokenRate || 20;
      console.log(`  ADCONFIG ${showId}: coinToTokenRate ${oldRate} → 100`);
      log.push({ type: 'adConfig', tenantId, showId, before: oldRate, after: 100 });

      if (!dryRun) {
        await fbPatch(`${tenantId}/events/showAdConfig/${showId}`, {
          coinToTokenRate: 100,
          updatedAt: new Date().toISOString()
        }, token);
      }
    }
  }

  // 4. Migrate transaction history token amounts
  if (wallets) {
    for (const [showId, showWallets] of Object.entries(wallets)) {
      for (const [vendorId] of Object.entries(showWallets)) {
        const txs = await fbGet(`${tenantId}/events/vendorTransactions/${showId}/${vendorId}`, token);
        if (txs) {
          let txCount = 0;
          for (const [txId, tx] of Object.entries(txs)) {
            if (tx.currency === 'tokens' && tx.amount) {
              const newAmount = tx.amount * MULTIPLIER;
              const newBalance = tx.balance ? tx.balance * MULTIPLIER : null;
              txCount++;
              if (!dryRun) {
                const patch = { amount: newAmount };
                if (newBalance !== null) patch.balance = newBalance;
                await fbPatch(`${tenantId}/events/vendorTransactions/${showId}/${vendorId}/${txId}`, patch, token);
              }
            }
          }
          if (txCount > 0) {
            console.log(`  TX ${showId}/${vendorId}: migrated ${txCount} token transactions (×${MULTIPLIER})`);
          }
        }
      }
    }
  }

  return log;
}

// ── Main ──

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run') || !args.includes('--apply');
  const tenantFilter = args.includes('--tenant') ? args[args.indexOf('--tenant') + 1] : null;

  if (dryRun && !tenantFilter) {
    console.log('MODE: DRY-RUN (all tenants). Use --apply to write changes, or --tenant <id> to target one.');
  } else if (dryRun) {
    console.log(`MODE: DRY-RUN (tenant: ${tenantFilter}). Use --apply to write changes.`);
  } else if (tenantFilter) {
    console.log(`MODE: APPLY (tenant: ${tenantFilter})`);
  } else {
    console.log('MODE: APPLY (all tenants)');
  }

  const token = getToken();

  // Get tenant list
  const tenants = await fbGet('mast-platform/tenants', token);
  const tenantIds = Object.entries(tenants)
    .filter(([id, t]) => t.status !== 'archived')
    .map(([id]) => id);

  console.log(`\nTenants found: ${tenantIds.join(', ')}`);

  const allLogs = [];

  for (const tenantId of tenantIds) {
    if (tenantFilter && tenantId !== tenantFilter) continue;
    const logs = await migrateTenant(tenantId, token, dryRun);
    allLogs.push(...logs);
  }

  // Summary
  console.log(`\n${'='.repeat(60)}`);
  console.log(`SUMMARY (${dryRun ? 'DRY-RUN' : 'APPLIED'})`);
  console.log('='.repeat(60));
  console.log(`Wallets migrated: ${allLogs.filter(l => l.type === 'wallet').length}`);
  console.log(`Ads migrated: ${allLogs.filter(l => l.type === 'ad').length}`);
  console.log(`Ad configs updated: ${allLogs.filter(l => l.type === 'adConfig').length}`);
  console.log(`Multiplier: ${MULTIPLIER}x (20:1 → 100:1)`);
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });
