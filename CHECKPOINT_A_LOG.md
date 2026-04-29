# Checkpoint A — Schema + Migration Scripts (append-only ledger)

**Branch:** `develop/A-schema` (off `origin/main` @ `b39b7b4`)
**Plan:** `~/.claude/plans/mast-product-lifecycle-develop-plan.md`
**Date:** 2026-04-28

## Commits

### mast-tenant-template (branch `develop/A-schema`)

- `373e819` — Add Product Lifecycle schema fields to MastDB.products
- `3f81fbd` — Document Product Lifecycle Schema in ARCHITECTURE.md

Pushed to `origin/develop/A-schema`.
PR URL: https://github.com/stewartdavidp-ship-it/mast-tenant-template/pull/new/develop/A-schema

### mast-architecture (branch `main`, local — not pushed)

- `62438b9` — Add migrate-products-to-lifecycle.py — Checkpoint A backfill

(7 prior unrelated unpushed commits sit ahead of origin/main; see `git log --oneline origin/main..HEAD`. Push deferred to owner.)

## Schema fields added on `MastDB.products`

Declarative — no behavior change yet. Added to `app/index.html` ~line 9608:

- `LIFECYCLE_STATUSES`, `ARCHIVED_SUB_STATES`, `ACQUISITION_TYPES` enums
- `defaultReadinessChecklist()` helper
- Convenience setters: `setLifecycleStatus`, `setArchivedSubState`, `setAcquisitionType`, `setReadinessChecklist`, `setPendingChanges`, `clearPendingChanges`

Field set documented in code comment + ARCHITECTURE.md:

```
status, archivedSubState, acquisitionType, hasPendingRevision,
pendingChanges, pendingChangesUpdatedAt, parentProductId, version,
readinessChecklist, promotedToReadyAt, promotedToActiveAt, archivedAt,
returnsAcceptedUntil, retiredAt
```

## Migration script

Path: `/Users/davidstewart/Developer/mast-architecture/scripts/migrate-products-to-lifecycle.py`

**Path resolution verified.** TENANT_COLLECTION_MAP at
`mast-mcp-server/src/shared/data-store/adapters/firestore-adapter.ts:36`
maps `public/products` → `products`. Tenant data lives at Firestore
`tenants/{tenantId}/products/{pid}` per the firestore-adapter header
comment. Script writes there directly via REST.

Flags: `--tenant-id <id>`, `--all-tenants`, `--commit` (default dry),
`--force` (overwrite existing values).

Backfill rules per plan:
- `status` → keep if already `draft|ready|active|archived`, else `'active'`
- `acquisitionType` → `'build'` if missing
- `version` → `1`, `parentProductId` → `null`
- `readinessChecklist` derived: `defined = !!recipeId||materials||buildIds`, `costed = priceCents>0`, `listingReady = images.length>0`, others `false`
- All date fields default `null`
- Patches use `updateMask.fieldPaths` so unrelated fields are preserved

## Dry-run output (sgtest15)

```
$ gcloud config set project mast-platform-prod
$ python3 scripts/migrate-products-to-lifecycle.py --tenant-id sgtest15

Product Lifecycle migration (DRY RUN)
Project: mast-platform-prod

=== Tenant: sgtest15 ===
Collection: tenants/sgtest15/products
  Total products: 46
  Would update: 46
  Skipped (already migrated): 0
  Status before: {'active': 43, 'archived': 2, 'draft': 1}
  Status after:  {'active': 43, 'archived': 2, 'draft': 1}
  Sample updates:
    - -Ooa73tAu0_Td0B35h0s ('Solid Sculptured Cardinal'):
        before: {acquisitionType: null, version: null, readinessChecklist: null, ...}
        after:  {acquisitionType: 'build', version: 1, readinessChecklist: {...}, ...}

=== Summary ===
  sgtest15                  total=46     would_update=46     skipped=0
  GRAND TOTAL               total=46  would_update=46  skipped=0

DRY RUN — pass --commit to actually write.
```

Status distribution looks healthy: 43 active, 2 archived, 1 draft. No products with malformed/unknown status. No `--commit` run in this checkpoint per plan.

## Deploy

```
mast_hosting deploy tenantId=sgtest15 branch=develop/A-schema
→ versionName: sites/mast-sgtest15/versions/176e819f4b442861
  filesTotal: 157, filesUploaded: 2, filesCached: 155
  url: https://mast-sgtest15.web.app
```

## Verification

- `curl https://mast-sgtest15.web.app/app/` → HTTP 200, 1.85MB
- `LIFECYCLE_STATUSES` constant present in deployed bundle
- `MastDB.products = {` block intact
- No regression observed (dry-run did not write; admin shell loaded)

## OPENs encountered (none new)

The plan's existing OPENs (O1–O5) remain. No new blockers.

## Ready for Checkpoint B?

Yes. Schema layer in place; migration script verified dry-run on sgtest15;
ARCHITECTURE.md updated; branch pushed; deploy clean. Checkpoint B
(Maker → Develop rename) can start from `origin/main` independently — A
is non-breaking.
