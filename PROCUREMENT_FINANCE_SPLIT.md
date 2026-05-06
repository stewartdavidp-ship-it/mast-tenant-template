# Procurement / Finance AP — Division of Responsibility

## 1. Current State

### Procurement module (`app/modules/procurement.js`)

**Purpose (as built):** Operational buying workflow — vendors, purchase orders, goods receipts, inventory lot creation, landed costs.

**Data it owns and writes:**
- `admin/vendors` — full CRUD (vendor master)
- `admin/productSuppliers` — supplier–product relationships with price history
- `admin/purchaseOrders` — PO lifecycle (draft → submitted → received → closed / cancelled)
- `admin/purchaseReceipts` — written on "Record Receipt": fields `receiptId`, `poId`, `receivedAt`, `vendorInvoiceRef`, `lines[]`, `additionalCosts[]`, `landedCostsApplied`, `landedCostAllocation`, `notes`, `createdAt`
- `admin/materialLots` / `admin/productLots` — created from receipt lines

**UI surfaces:**
- KPI band: Open PO count, outstanding PO value, inventory value, last receipt date
- Open POs tab: filterable PO list, expandable rows showing line-level receipt/receive progress, "Record Receipt" and "Cancel PO" actions
- Vendors tab: vendor card grid with spend/product counts, + New Vendor
- Inventory Lots tab: material lots grouped by material, qty remaining, unit cost (pre/post landed)
- Vendor Detail: Products sub-tab (price sparkline), POs sub-tab, Receipts sub-tab (receipt date, invoice ref, value)
- Lot Detail: provenance — material, qty, unit cost, vendor, PO, receipt

**Payment-related concepts present:** `paymentTerms` is captured as text metadata on vendors and POs. That's all. No `paymentStatus`, no `dueDate`, no `paidAmount` — Procurement does not track whether a receipt has been paid.

### Finance AP tab (`app/modules/finance.js`, lines 965–1172)

**Purpose (as built):** Financial obligation tracking — what is owed, to whom, when is it due, how overdue.

**Data it reads:**
- `admin/purchaseReceipts` — queries `orderByChild('paymentStatus').equalTo('unpaid')` and `equalTo('partial')`
- `admin/vendors` — vendor name lookup only (read, no writes)

**Fields it reads from receipts:** `amountCents`, `paidAmount`, `dueDate`, `paymentStatus`, `vendorId`, `vendorInvoiceRef`, `receiptId`

**Fields it writes to receipts (payment actions):** `paymentStatus`, `paidAmount`, `updatedAt`

**UI surfaces:**
- Summary cards: Total AP, aging buckets (Current, 30+, 60+, 90+)
- Filterable table: Vendor, Ref, Total, Paid, Remaining, Due Date, Age badge, Status badge
- "Paid" action → sets `paymentStatus: 'paid'`, `paidAmount: totalCents`
- "Partial" action → inline modal accumulating `paidAmount`, derives `paymentStatus`
- Cash Flow tab also reads the same receipts for AP totals (lines 668–720)

### Where they overlap

| Element | Procurement | Finance AP |
|---|---|---|
| `admin/purchaseReceipts` | Writes operational fields (received date, lines, lots, landed costs) | Reads/writes payment fields |
| `admin/vendors` | Full CRUD master | Name lookup only |
| Receipt value display | Shown as line-value sum (qty × cost) in operational context | Shown as `amountCents` (cents field) for financial obligation |

---

## 2. The Critical Data Gap (Blocker)

**Procurement's `saveReceipt()` (line ~1302) writes NO payment fields.**

The receipt object written contains: `receiptId`, `poId`, `receivedAt`, `receivedBy`, `vendorInvoiceRef`, `fxRateAtReceipt`, `lines[]`, `additionalCosts[]`, `notes`, `createdAt`.

Finance AP queries: `orderByChild('paymentStatus').equalTo('unpaid')` — this will never match a receipt created by Procurement, because `paymentStatus` is never set.

Finance AP reads `r.amountCents` for the invoice total — also never set by Procurement.

**Result: Finance AP currently sees zero receipts from Procurement. The two surfaces are architecturally connected (same collection) but currently disconnected at the data layer.**

This means Finance AP's AP aging view, Cash Flow AP totals, and Mark Paid actions all operate in a vacuum until receipts are seeded with the missing fields.

---

## 3. Proposed Division of Responsibility

**One-line rule for each surface:**

> **Procurement** — "Did we receive it, and what did it cost?" (operational fact)
> **Finance AP** — "Have we paid for it, and when is it due?" (financial obligation)

### The mental model

The receipt is the handoff object. Procurement creates it (operational event). Finance AP owns it as a financial obligation from that point forward.

```
Vendor → PO → Receipt (Procurement creates) → Finance AP picks it up → Mark Paid
              ↕                                ↕
         (what, qty, cost)              (amountCents, dueDate, paymentStatus)
```

**Procurement's scope:**
- Create and manage vendors
- Create and manage purchase orders (all statuses)
- Record goods receipts (quantities received, unit costs, lot numbers, additional freight costs)
- Apply landed costs to lots
- Show inventory on hand (lot view)
- Show receipt history per vendor and per PO (operational audit trail)

**Finance AP's scope:**
- Show all unpaid/partial receipts as a financial aging report
- Record payment (full or partial) against any receipt
- Report AP totals by aging bucket for cash flow planning

**What does NOT belong in Procurement:**
- No "Mark Paid" button — payment recording is Finance AP's job
- No payment aging display — that context belongs in Finance, not procurement operations

**What does NOT belong in Finance AP:**
- No vendor management (no contact info, no edit)
- No lot detail or landed cost operations
- No receipt creation — receipts are created only through the Procurement workflow

---

## 4. Rationalization Needed

### 4a. Critical fix — seed payment fields on receipt creation

In `procurement.js`, `saveReceipt()` (line ~1302), the `receipt` object needs three additional fields:

```javascript
paymentStatus: 'unpaid',
amountCents: Math.round(totalReceiptValue * 100),
dueDate: computeDueDateFromTerms(po.paymentTerms, receivedAt),
```

Where:
- `totalReceiptValue` = sum of `(rl.qtyReceivedNow × rl.unitCostHomeCurrency)` across all receipt lines (already computed implicitly in the render, needs to be extracted)
- `computeDueDateFromTerms(terms, receivedAt)` = parse "net-30", "net-60" etc. from `po.paymentTerms` string and add that many days to `receivedAt`; return null if terms is absent or non-parseable

Without this fix, Finance AP is permanently empty of Procurement-originated receipts.

### 4b. Payment status badge on Procurement receipt cards

In `renderPoExpand()` (line ~386) and `renderVendorReceipts()` (line ~718), each receipt card should show a payment status badge:

- Read `r.paymentStatus` (which Procurement doesn't currently write or display)
- Show as a small badge: "unpaid" (red), "partial" (yellow), "paid" (green)
- This gives operations staff visibility into payment status without navigating to Finance

No write access needed — Procurement would only display this field, not modify it.

### 4c. No duplication of payment actions

Confirmed: Procurement has zero "Mark Paid" or partial payment UI. No conflict exists. Finance AP owns all payment write paths exclusively.

### 4d. Vendor data: read-only in Finance AP (confirmed correct)

Finance AP loads `admin/vendors` for vendor name display only. Procurement owns vendor CRUD. No rationalization needed here — the separation is clean.

---

## 5. Cross-Links

### Finance AP → Procurement

Each row in Finance AP's aging table has `receiptId` and `poId` available. Add a "View" link per row that navigates to Procurement and opens the vendor detail or PO detail:

```
navigateTo('procurement') + open vendor detail for r.vendorId
```

This lets a user in Finance AP who wants to check what was actually received jump directly to the Procurement receipt context without manually navigating.

**Minimum viable:** Add a small "→ Procurement" link/button in each table row that calls `navigateTo('procurement')` (the empty state already does this at line 1073). A fuller version would deep-link to the specific vendor.

### Procurement → Finance AP

On each receipt card in:
1. PO expand view (`renderPoExpand()`, line ~386)
2. Vendor Receipts sub-tab (`renderVendorReceipts()`, line ~718)

Add a payment status badge that reads `r.paymentStatus`. If the user wants to act on it, the badge can include a small "Pay →" link that calls `navigateTo('finance-ap')`. This makes the handoff point visible to operations staff without cluttering the Procurement workflow.

---

## 6. Open Questions

1. **`amountCents` computation** — Should it include `additionalCosts[]` (e.g., freight captured at receipt time)? The current Finance AP shows one "Total" per receipt, so including additional costs in `amountCents` seems correct — it represents the full vendor invoice amount. But if additional costs are captured separately (not yet billed or billed separately), splitting them out may be needed.

2. **`dueDate` from `paymentTerms`** — What should happen when `paymentTerms` is null, blank, or non-standard (e.g., "COD", "end of month")? Options: (a) leave `dueDate: null` so Finance AP shows "—" but still surfaces the receipt as unpaid, (b) default to a configurable net-days setting on the vendor record. Currently there's no fallback — Finance AP will show "—" for due date but still age from today correctly.

3. **Finance AP cross-link depth** — Should "View in Procurement" navigate to the vendor detail (showing all their receipts) or should Procurement grow a receipt-detail view (showing one receipt in full)? A receipt-detail view doesn't exist yet. The vendor detail is the closest analog.

4. **Historical receipts** — Receipts that already exist in the database without `paymentStatus` (created before this split was implemented) will be invisible to Finance AP. A one-time backfill script or a query fallback (`paymentStatus === undefined → treat as 'unpaid'`) would be needed.

5. **Aggregate view conflict display** — Not a current concern for AP specifically, but if a DECISION in Finance AP (e.g., "record payments at receipt date") contradicts a RULE in Procurement (e.g., "don't write financial fields in the operational path"), those need to be reconciled explicitly.

---

## Summary

The two surfaces are cleanly separable by the operational/financial axis with one exception: **Procurement's `saveReceipt()` must be patched to write `paymentStatus: 'unpaid'`, `amountCents`, and `dueDate` so Finance AP can see the receipts at all.** This is not a design question — it's a missing wire. Without it, Finance AP's AP aging and Cash Flow AP totals will always show zero regardless of how much the business has purchased.

The patch is small (3 fields in one function) and does not change the Procurement UX. All other aspects of the division are already correct in the current code: Procurement has no payment actions, Finance AP has no receipt creation or vendor management.
