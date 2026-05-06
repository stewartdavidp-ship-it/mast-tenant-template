# Finance Module — Test Case Specification
**For Session 3 (MCP Tool Build & Validation)**
**Tenant under test:** `sgtest15` (or `dev` if sgtest15 unavailable)
**Reference date:** 2026-05-01 (all aging calculations use this as "today")

---

## Schema Reconciliation (Session 3 corrections vs. Session 1 FINANCE_SCHEMA.md)

The following table documents Session 3's corrections. All collection paths and field names below supersede the original assumptions.

| Item | Original assumption | Corrected per FINANCE_SCHEMA.md | Notes |
|---|---|---|---|
| Time clock collection | `admin/timeClock/` | `admin/timeEntries/` | Schema Section 2 |
| Time clock clock-in field | `clockedInAt` | `clockIn` | Schema Section 2 |
| Time clock clock-out field | `clockedOutAt` | `clockOut` | Schema Section 2 |
| Time clock open status | `status: "open"` | `status: "active"` | Schema: `active \| complete \| adjusted` |
| Time clock closed status | `status: "complete"` | `status: "complete"` | Unchanged |
| PTO policy collection | `admin/pto/policies/` | `admin/ptoPolicy/` | Schema Section 2 |
| PTO policy grant type field | `grantType` | `accrualType` | Schema: `hourly \| annual-grant \| none` |
| PTO policy fixed-grant field | `annualGrantHours` | `accrualRate` | Schema: accrualRate = total hours/year for annual-grant |
| PTO policy accrual rate field | `accrualRateHoursPerHoursWorked` | `accrualRate` | Schema: same field, value is rate (e.g. 0.025) |
| PTO entries collection | `admin/pto/entries/` | `admin/ptoEntries/` | Schema Section 2 |
| PTO entry hours-used field | `hoursUsed` | `hours` (negative value) | Schema: positive=accrual, negative=used |
| Invoices collection | `admin/invoices/` (separate) | **Fields on orders** | Schema Section 3: invoice fields are additive fields on orders |
| Invoice `dueAt` field | `dueAt` | `invoiceDueDate` | Schema Section 3 |
| Invoice `amountCents` field | `amountCents` | `total * 100` (convert from dollars) | Orders store `total` in dollars; tools return cents |
| Invoice `paidAmountCents` field | `paidAmountCents` | `invoicePaidAmount` (cents) | New field per schema |
| Nexus registrations | `admin/nexusRegistrations/{stateCode}` | `admin/nexusRegistrations/{stateCode}` | Added to FINANCE_SCHEMA.md in Session 3 |
| Journal entries `pnlLine` field | `pnlLine` | `category` maps to P&L line | Schema uses `category: payroll \| cogs-adjustment \| ...` and `type: debit \| credit` |
| Order invoice status field | `paymentStatus: "unpaid"` | `invoiceStatus: "sent"` | Schema Section 3: `draft \| sent \| paid \| overdue` |
| Order payment due date field | `paymentDueDate` | `invoiceDueDate` | Schema Section 3 |
| Order `totalCents` field | `totalCents` | `total` (dollars, ×100 in tool output) | Existing orders use dollars; Finance tools convert |
| Order `taxCents` field | `taxCents` | `tax` (dollars, ×100 in tool output) | Same conversion pattern |
| Order `shippingState` field | `shippingState` | `taxState` | Schema Section 1: existing field |
| Vendor `payeeType` field | `payeeType` | `vendorType` with values `contractor \| vendor` | Added in Finance phase |
| Receipt `amountCents` field | `amountCents` | `amountCents` | New field added per Finance schema |
| Receipt `invoiceDueDate` field | `invoiceDueDate` | `dueDate` | Schema Section 3: `dueDate` not `invoiceDueDate` |
| Receipt `paidAmountCents` field | `paidAmountCents` | `paidAmount` (cents) | Schema Section 3 |
| Revenue source | `admin/salesCache/` | `orders/` (online) + `admin/sales/` (POS) | Schema Section 1 |
| Sales cache `totalAmount` field | `totalAmount` (cents) | `amount` (dollars) for admin/sales | Schema Section 1: `amount` in dollars |

### Resolved Open Questions (from session prompt)

| Question | Decision |
|---|---|
| 1099 $600 boundary | **Exclusive**: `> $600` strictly. $600.00 exact does NOT trigger 1099 |
| Nexus "approaching" threshold | **75%** of $100K threshold ($75K or 150 transactions) |
| Nexus $100K boundary | **Exclusive**: `> $100,000` triggers nexus. Exactly $100K does not |
| COGS definition | Expense-based only: `expenses.category == "materials"` + `journalEntries.category == "cogs-adjustment"` |
| AR aging data source | Orders directly (`invoiceStatus in [sent, overdue]`), not invoices collection |
| PTO negative balance | Soft-allow with explicit `negative: true` flag |
| Cash flow net position | Separate fields (bankBalance, arOutstanding, apDue) — no net calculation |

---

---

## Section 1 — P&L (Profit & Loss)

### PNL-001 — Single month with all revenue and expense types

**Description:** A complete April 2026 P&L with Square sales, a manual POS sale, materials COGS, payroll, and software expense. Validates that revenue, COGS, and operating expenses are summed correctly.

**Seed data required:**
- `admin/salesCache/txn-001`: `{ processor: "square", totalAmount: 50000, processingFee: 175, createdAt: "2026-04-10T14:00:00Z", orderSource: "online" }`
- `admin/salesCache/txn-002`: `{ processor: "square", totalAmount: 30000, processingFee: 117, createdAt: "2026-04-20T10:00:00Z", orderSource: "online" }`
- `admin/salesCache/txn-003`: `{ processor: "manual", totalAmount: 20000, processingFee: 0, createdAt: "2026-04-25T15:30:00Z", orderSource: "pos" }`
- `admin/expenses/exp-001`: `{ amount: 15000, date: "2026-04-08", category: "materials", reviewed: true, merchantName: "Clay Supplier Co" }`
- `admin/expenses/exp-002`: `{ amount: 5000, date: "2026-04-20", category: "software", reviewed: true, merchantName: "Adobe" }`
- `admin/journalEntries/je-001`: `{ date: "2026-04-30", description: "April payroll", amount: 150000, pnlLine: "payroll", category: "payroll" }`

**MCP Tool Call:**
```json
{
  "tool": "finance_get_pnl",
  "arguments": {
    "tenantId": "sgtest15",
    "startDate": "2026-04-01",
    "endDate": "2026-04-30"
  }
}
```

**Expected Output:**
```json
{
  "period": { "start": "2026-04-01", "end": "2026-04-30" },
  "revenue": 100000,
  "cogs": 15000,
  "grossProfit": 85000,
  "operatingExpenses": 155000,
  "netProfit": -70000,
  "breakdown": {
    "revenue": { "square": 80000, "manual": 20000 },
    "cogs": { "materials": 15000 },
    "expenses": { "software": 5000, "payroll": 150000 }
  }
}
```
(All values in cents. $1,000 revenue - $150 COGS = $850 gross profit - $1,550 opex = -$700 net)

**Pass criterion:** `revenue == 100000`, `cogs == 15000`, `grossProfit == 85000`, `operatingExpenses == 155000`, `netProfit == -70000`. Processing fees not deducted from revenue (shown separately if at all).

**Edge case:** An unreviewed expense (`reviewed: false`) for April — should NOT appear in operating expenses. Seed `admin/expenses/exp-unreviewed: { amount: 2000, date: "2026-04-22", category: "travel", reviewed: false }` and confirm it is excluded from PNL-001 output.

---

### PNL-002 — Period with no data (empty month)

**Description:** Query a month with zero transactions or expenses. Must return zeros without throwing an error.

**Seed data required:** None (February 2025 should have no data for sgtest15).

**MCP Tool Call:**
```json
{ "tool": "finance_get_pnl", "arguments": { "tenantId": "sgtest15", "startDate": "2025-02-01", "endDate": "2025-02-28" } }
```

**Expected Output:**
```json
{ "period": { "start": "2025-02-01", "end": "2025-02-28" }, "revenue": 0, "cogs": 0, "grossProfit": 0, "operatingExpenses": 0, "netProfit": 0, "breakdown": {} }
```

**Pass criterion:** Response is a valid object with all numeric fields = 0. No error thrown, no 500.

**Edge case:** Query a single day (startDate == endDate) with no data. Same result expected.

---

### PNL-003 — Period spanning a month boundary

**Description:** A date range from April 20 to May 5 should capture sales in both months.

**Seed data required:**
- Re-uses `txn-002` (2026-04-20, $300) and `txn-003` (2026-04-25, $200) from PNL-001
- `admin/salesCache/txn-004`: `{ processor: "square", totalAmount: 10000, processingFee: 39, createdAt: "2026-05-02T11:00:00Z" }`

**MCP Tool Call:**
```json
{ "tool": "finance_get_pnl", "arguments": { "tenantId": "sgtest15", "startDate": "2026-04-20", "endDate": "2026-05-05" } }
```

**Expected Output:**
```json
{ "revenue": 60000, ... }
```
($300 + $200 + $100 = $600.00)

**Pass criterion:** `revenue == 60000`. Transaction on 2026-04-10 (`txn-001`) is NOT included (outside range).

**Edge case:** Transaction with `createdAt` exactly at midnight on the boundary date (2026-04-20T00:00:00Z) — confirm it is included.

---

### PNL-004 — Revenue from multiple channels

**Description:** A month with Square, manual, and Etsy sales. Breakdown must show each channel separately.

**Seed data required:**
- `admin/salesCache/txn-march-01`: `{ processor: "square", totalAmount: 30000, createdAt: "2026-03-15T10:00:00Z", orderSource: "online" }`
- `admin/salesCache/txn-march-02`: `{ processor: "manual", totalAmount: 10000, createdAt: "2026-03-20T14:00:00Z", orderSource: "pos" }`
- `admin/salesCache/txn-march-03`: `{ processor: "etsy", totalAmount: 20000, createdAt: "2026-03-22T09:00:00Z", orderSource: "etsy" }`

**MCP Tool Call:**
```json
{ "tool": "finance_get_pnl", "arguments": { "tenantId": "sgtest15", "startDate": "2026-03-01", "endDate": "2026-03-31" } }
```

**Expected Output:** `revenue == 60000`, breakdown shows `square: 30000, manual: 10000, etsy: 20000`.

**Pass criterion:** Revenue per channel must match exact amounts. Total revenue = sum of all channels.

**Edge case:** A "manual" POS sale with no `orderSource` field set — confirm it still appears in revenue (defaulting to "manual" or "unknown").

---

### PNL-005 — Payroll journal entry appears in correct P&L line

**Description:** Payroll written as a journal entry (not a Plaid expense) must appear in Operating Expenses under "Payroll", not COGS.

**Seed data required:** Re-uses `je-001` from PNL-001 ($1,500 payroll journal entry, 2026-04-30).

**MCP Tool Call:** Same as PNL-001 (April 2026 query).

**Expected Output:** `breakdown.expenses.payroll == 150000`. The journal entry is NOT in `breakdown.cogs`.

**Pass criterion:** Journal entry with `pnlLine: "payroll"` appears in operating expenses, not COGS.

**Edge case:** Journal entry with `pnlLine: "cogs"` should flow to COGS, not operating expenses. Seed `admin/journalEntries/je-002: { date: "2026-04-28", description: "Kiln firing cost", amount: 7500, pnlLine: "cogs" }` and confirm it reduces gross profit.

---

## Section 2 — AR Aging

**All tests use `asOfDate: "2026-05-01"`.** Aging buckets: Current (not yet due), 1–30 days, 31–60 days, 61–90 days, 90+ days.

### AR-001 — Current invoice (not yet due)

**Seed data:** `orders/order-W001`: `{ isWholesale: true, customerName: "Blue Door Gallery", customerEmail: "buy@bluedoor.com", subtotalCents: 120000, taxCents: 0, totalCents: 120000, paymentStatus: "unpaid", paymentDueDate: "2026-05-20", placedAt: "2026-04-20T09:00:00Z", status: "confirmed" }`

**MCP Tool Call:**
```json
{ "tool": "finance_get_ar_aging", "arguments": { "tenantId": "sgtest15", "asOfDate": "2026-05-01" } }
```

**Expected Output:** order-W001 appears in bucket `current` with `amountDue: 120000`, `daysOverdue: 0`.

**Pass criterion:** `current` bucket contains order-W001. No other bucket contains it.

**Edge case:** An order with no `paymentDueDate` set. Tool must handle gracefully — either exclude it or place it in a "no due date" bucket, not error.

---

### AR-002 — Invoice 31 days overdue

**Seed data:** `orders/order-W002`: `{ isWholesale: true, customerName: "Maple Leaf Ceramics", totalCents: 50000, paymentStatus: "unpaid", paymentDueDate: "2026-03-31", placedAt: "2026-02-28T00:00:00Z", status: "confirmed" }`

**Expected Output:** order-W002 in bucket `31_to_60` with `daysOverdue: 31`.

**Pass criterion:** `daysOverdue == 31` (2026-05-01 minus 2026-03-31 = 31 days).

**Edge case:** An invoice due exactly on the asOfDate (2026-05-01). Must go to `current` bucket (0 days overdue), not `1_to_30`.

---

### AR-003 — Invoice 65 days overdue

**Seed data:** `orders/order-W003`: `{ isWholesale: true, customerName: "Desert Sand Studio", totalCents: 75000, paymentStatus: "unpaid", paymentDueDate: "2026-02-25", status: "confirmed" }`

**Expected Output:** order-W003 in bucket `61_to_90` with `daysOverdue: 65`.

**Pass criterion:** `daysOverdue == 65` and bucket is `61_to_90`.

**Edge case:** An invoice due 2026-02-28 (60 days before 2026-04-29, not 2026-05-01). Confirm the boundary: 60 days from 2026-05-01 = 2026-03-02. Due 2026-03-02 → `1_to_30`; due 2026-03-01 → `31_to_60`. Verify fence-post math is correct.

---

### AR-004 — Invoice 95 days overdue (90+ bucket)

**Seed data:** `orders/order-W004`: `{ isWholesale: true, customerName: "Northwoods Gifts", totalCents: 20000, paymentStatus: "unpaid", paymentDueDate: "2026-01-26", status: "confirmed" }`

**Expected Output:** order-W004 in bucket `90_plus` with `daysOverdue: 95`.

**Pass criterion:** Bucket is `90_plus`, `daysOverdue >= 90`.

**Edge case:** Invoice 365+ days overdue. Confirm it still appears in `90_plus` and does not error.

---

### AR-005 — Paid invoice should not appear

**Seed data:** `orders/order-W005`: `{ isWholesale: true, customerName: "River Arts", totalCents: 90000, paymentStatus: "paid", paidAt: "2026-04-01T00:00:00Z", paymentDueDate: "2026-03-31", status: "confirmed" }`

**Expected Output:** order-W005 does NOT appear in any aging bucket.

**Pass criterion:** Scanning all returned buckets, `order-W005` is absent.

**Edge case:** A partially paid invoice (`paidAmountCents < totalCents`). Must appear with `amountDue = totalCents - paidAmountCents`, not `totalCents`.

---

### AR-006 — Customer with multiple open invoices

**Seed data:**
- `orders/order-W006`: `{ isWholesale: true, customerName: "Acme Gallery", totalCents: 60000, paymentStatus: "unpaid", paymentDueDate: "2026-04-11" }` (20 days overdue)
- `orders/order-W007`: `{ isWholesale: true, customerName: "Acme Gallery", totalCents: 40000, paymentStatus: "unpaid", paymentDueDate: "2026-03-17" }` (45 days overdue)

**Expected Output:** Both orders appear — W006 in `1_to_30`, W007 in `31_to_60`. If a per-customer summary is included, "Acme Gallery" total outstanding = $1,000.00.

**Pass criterion:** Both orders present in correct buckets. Customer total outstanding = 100000 cents if summary is included.

**Edge case:** Same customer with one invoice per aging bucket. Confirm the tool does not deduplicate or merge them into a single line.

---

## Section 3 — AP Aging

**All tests use `asOfDate: "2026-05-01"`.** AP aging uses `invoiceDueDate` on purchase receipts, not on POs.

### AP-001 — Current vendor receipt (not yet due)

**Seed data:** `admin/purchaseReceipts/receipt-abc-001`: `{ vendorId: "vendor-abc", vendorInvoiceRef: "INV-ABC-100", amountCents: 80000, paidAmountCents: 0, paymentStatus: "unpaid", invoiceDueDate: "2026-05-20", receivedAt: "2026-04-22T00:00:00Z" }` and `admin/vendors/vendor-abc`: `{ name: "ABC Supplies", payeeType: "vendor" }`

**MCP Tool Call:**
```json
{ "tool": "finance_get_ap_aging", "arguments": { "tenantId": "sgtest15", "asOfDate": "2026-05-01" } }
```

**Expected Output:** receipt-abc-001 in `current` bucket, `amountDue: 80000`, `vendorName: "ABC Supplies"`.

**Pass criterion:** Receipt in `current` bucket. `amountDue` equals full amount (no partial payment).

**Edge case:** A purchase receipt with no `invoiceDueDate` (net terms not recorded). Must not error — place in a "no terms" bucket or exclude with a warning in the response.

---

### AP-002 — Receipt 31 days overdue

**Seed data:** `admin/purchaseReceipts/receipt-xyz-001`: `{ vendorId: "vendor-xyz", amountCents: 40000, paidAmountCents: 0, paymentStatus: "unpaid", invoiceDueDate: "2026-03-31" }` and `admin/vendors/vendor-xyz`: `{ name: "XYZ Materials" }`

**Expected Output:** receipt-xyz-001 in `31_to_60` bucket, `daysOverdue: 31`.

**Pass criterion:** Correct bucket and day count.

**Edge case:** Receipt for a deleted/missing vendor. Tool must return `vendorName: "Unknown"` or equivalent rather than throwing.

---

### AP-003 — Vendor with multiple open receipts

**Seed data:**
- `admin/purchaseReceipts/receipt-xyz-002`: `{ vendorId: "vendor-xyz", amountCents: 50000, paidAmountCents: 0, paymentStatus: "unpaid", invoiceDueDate: "2026-05-10" }` (current, 9 days until due)
- `admin/purchaseReceipts/receipt-xyz-003`: `{ vendorId: "vendor-xyz", amountCents: 30000, paidAmountCents: 0, paymentStatus: "unpaid", invoiceDueDate: "2026-04-01" }` (30 days overdue)

**Expected Output:** Both receipts appear — receipt-xyz-002 in `current`, receipt-xyz-003 in `1_to_30`. Vendor "XYZ Materials" total outstanding = $800 (receipt-xyz-001 + receipt-xyz-002 + receipt-xyz-003 = $40,000 + $50,000 + $30,000 = $120,000 cents = $1,200).

**Pass criterion:** Both receipts present in correct buckets. Per-vendor total = $1,200 if vendor summary included.

**Edge case:** Vendor has 20+ open receipts. Confirm the tool does not cap or truncate AP results — all open receipts must be returned.

---

### AP-004 — Partially paid receipt

**Seed data:** `admin/purchaseReceipts/receipt-pqr-001`: `{ vendorId: "vendor-pqr", amountCents: 100000, paidAmountCents: 40000, paymentStatus: "partial", invoiceDueDate: "2026-05-15" }` and `admin/vendors/vendor-pqr`: `{ name: "PQR Distribution" }`

**Expected Output:** receipt-pqr-001 in `current` bucket with `amountDue: 60000` (not 100000).

**Pass criterion:** `amountDue == totalCents - paidAmountCents == 60000`. Full amount (100000) is not used.

**Edge case:** Receipt where `paidAmountCents == amountCents` (fully paid but `paymentStatus` still "partial" due to a data bug). Tool must exclude it from aging — check paid status, not just payment amount.

---

## Section 4 — Sales Tax by State

### TAX-001 — Single state, single period

**Seed data:**
- `orders/ORD-T001`: `{ shippingState: "TX", subtotalCents: 12500, taxCents: 1250, totalCents: 13750, status: "delivered", placedAt: "2026-03-05T00:00:00Z" }`
- `orders/ORD-T002`: `{ shippingState: "TX", subtotalCents: 8750, taxCents: 875, totalCents: 9625, status: "delivered", placedAt: "2026-03-12T00:00:00Z" }`
- `orders/ORD-T003`: `{ shippingState: "TX", subtotalCents: 5000, taxCents: 500, totalCents: 5500, status: "delivered", placedAt: "2026-03-18T00:00:00Z" }`

**MCP Tool Call:**
```json
{ "tool": "finance_get_tax_summary", "arguments": { "tenantId": "sgtest15", "startDate": "2026-03-01", "endDate": "2026-03-31" } }
```

**Expected Output:**
```json
{ "period": { "start": "2026-03-01", "end": "2026-03-31" }, "byState": { "TX": { "orderCount": 3, "subtotal": 26250, "taxCollected": 2625 } } }
```

**Pass criterion:** `TX.taxCollected == 2625` ($26.25). Only TX appears in results.

**Edge case:** An order with `status: "cancelled"` and a matching date. Must be excluded from tax totals.

---

### TAX-002 — Multiple states in same period

**Seed data:**
- `orders/ORD-T004`: `{ shippingState: "TX", subtotalCents: 20000, taxCents: 2000, status: "delivered", placedAt: "2026-04-10T00:00:00Z" }`
- `orders/ORD-T005`: `{ shippingState: "CA", subtotalCents: 35000, taxCents: 3500, status: "delivered", placedAt: "2026-04-15T00:00:00Z" }`
- `orders/ORD-T006`: `{ shippingState: "NY", subtotalCents: 15000, taxCents: 1500, status: "delivered", placedAt: "2026-04-20T00:00:00Z" }`

**MCP Tool Call:** Same tool, `startDate: "2026-04-01"`, `endDate: "2026-04-30"`.

**Expected Output:** `byState` has entries for TX, CA, and NY. `TX.taxCollected: 2000`, `CA.taxCollected: 3500`, `NY.taxCollected: 1500`. Total across all states = 7000 cents ($70.00).

**Pass criterion:** Three state entries present. Each matches expected tax amount. No states from other periods bleed in.

**Edge case:** Two orders to the same state in the same period — confirm they are summed, not deduplicated.

---

### TAX-003 — State with zero tax collected

**Seed data:** `orders/ORD-T007`: `{ shippingState: "CO", subtotalCents: 10000, taxCents: 0, totalCents: 10000, status: "delivered", placedAt: "2026-03-25T00:00:00Z" }`

**MCP Tool Call:** Same tool, March 2026.

**Expected Output:** `byState.CO` exists and shows `taxCollected: 0, orderCount: 1`. (CO appears because there's a sale there, even with no tax collected — important for nexus tracking.)

**Pass criterion:** CO is present in `byState` with `taxCollected: 0`. It is not silently omitted.

**Edge case:** Optional `state` filter param. Call with `state: "CO"` and confirm only CO is returned. Call with `state: "WA"` (no WA orders) and confirm empty result, no error.

---

### TAX-004 — Period with no orders

**Seed data:** None (January 2025 should be empty).

**MCP Tool Call:** Same tool, `startDate: "2025-01-01"`, `endDate: "2025-01-31"`.

**Expected Output:** `{ "byState": {}, "period": {...} }` — empty object, no error.

**Pass criterion:** Valid response with empty `byState`. HTTP 200, no exception.

**Edge case:** Period with orders but all have null/missing `shippingState`. Confirm they appear under a `"UNKNOWN"` key or are explicitly excluded with a count in a `missingState` field — not silently dropped.

---

## Section 5 — Economic Nexus Tracker

**Threshold:** $100,000 in sales OR 200 transactions per state per calendar year. Registration data stored in `admin/nexusRegistrations/{stateCode}`.

### NEX-001 — State below both thresholds

**Seed data:** Seed 5 Wyoming orders totaling $45,000 (all in 2026):
- `orders/ORD-NEX-WY-{1..5}`: `{ shippingState: "WY", totalCents: 9000, status: "delivered", placedAt: "2026-01-15T00:00:00Z" }` through `"2026-04-10T00:00:00Z"`

No nexus registration for WY.

**MCP Tool Call:**
```json
{ "tool": "finance_get_nexus_status", "arguments": { "tenantId": "sgtest15", "year": 2026 } }
```

**Expected Output:** WY entry shows `{ salesTotal: 45000, transactionCount: 5, thresholdMet: false, salesThresholdPct: 45, countThresholdPct: 2, registered: false, flag: "below_threshold" }`.

**Pass criterion:** `thresholdMet: false`, `flag: "below_threshold"`.

**Edge case:** State with exactly $100,000 in sales (100% of threshold). Boundary: is $100,000 "met" (flag) or not? See Open Questions.

---

### NEX-002 — State approaching $ threshold

**Seed data:** 5 Colorado orders totaling $85,000:
- `orders/ORD-NEX-CO-{1..5}`: `{ shippingState: "CO", totalCents: 17000, status: "delivered" }` (spread across Jan–Apr 2026)

No nexus registration for CO.

**Expected Output:** CO shows `salesTotal: 85000, thresholdMet: false, salesThresholdPct: 85, flag: "approaching"` (85% of $100K threshold — within warning zone).

**Pass criterion:** `flag` is `"approaching"` (not `"below_threshold"` and not `"threshold_met"`). Specific threshold for "approaching" warning is a design decision — see Open Questions.

**Edge case:** State that passes the transaction count (200+) but stays below the $ threshold. Must flag based on whichever threshold is breached first.

---

### NEX-003 — State above threshold (unregistered, must flag)

**Seed data:** 5 Texas orders totaling $125,000:
- `orders/ORD-NEX-TX-{1..5}`: `{ shippingState: "TX", totalCents: 25000, status: "delivered" }`

No nexus registration for TX.

**Expected Output:** TX shows `salesTotal: 125000, thresholdMet: true, registered: false, flag: "action_required"`.

**Pass criterion:** `thresholdMet: true`, `registered: false`, `flag: "action_required"`. This state must be prominently highlighted.

**Edge case:** State where sales are $99,999 (one cent below threshold). Must NOT be flagged as threshold_met.

---

### NEX-004 — Above threshold but already registered

**Seed data:** 5 California orders totaling $125,000 (same structure as NEX-003) PLUS `admin/nexusRegistrations/CA`: `{ state: "CA", registered: true, registeredAt: "2025-06-01T00:00:00Z" }`.

**Expected Output:** CA shows `salesTotal: 125000, thresholdMet: true, registered: true, flag: "registered"`.

**Pass criterion:** `flag` must be `"registered"`, NOT `"action_required"`. These are distinct states.

**Edge case:** A registered state where sales then drop below threshold in a later year. Should flag `"registered_below_threshold"` (you may be able to deregister) — or at minimum NOT show `"action_required"`.

---

## Section 6 — 1099 Prep

**1099-NEC threshold: IRS requires form for contractors paid $600 or more in the calendar year. See Open Questions for boundary treatment.**

### 1099-001 — Contractor paid exactly $600

**Seed data:**
- `admin/vendors/vendor-john`: `{ name: "John Doe", payeeType: "contractor", taxId: "12-3456789" }`
- `admin/purchaseReceipts/receipt-J1`: `{ vendorId: "vendor-john", amountCents: 60000, receivedAt: "2026-03-01T00:00:00Z", paymentStatus: "paid" }`

**MCP Tool Call:**
```json
{ "tool": "finance_get_1099_prep", "arguments": { "tenantId": "sgtest15", "year": 2026 } }
```

**Expected Output:** John Doe appears in results with `totalPaid: 60000`. Inclusion or exclusion depends on boundary rule (see Open Questions).

**Pass criterion:** The result is consistent with the decided boundary rule. See Open Questions — this test case is intentionally boundary-targeting.

**Edge case:** Contractor paid exactly $599.99. Must NOT appear in 1099 results regardless of boundary decision.

---

### 1099-002 — Contractor paid $601 (clearly above threshold)

**Seed data:**
- `admin/vendors/vendor-jane`: `{ name: "Jane Smith", payeeType: "contractor", taxId: "98-7654321" }`
- `admin/purchaseReceipts/receipt-J2`: `{ vendorId: "vendor-jane", amountCents: 60100, receivedAt: "2026-04-01T00:00:00Z", paymentStatus: "paid" }`

**Expected Output:** Jane Smith appears with `totalPaid: 60100`, `taxId: "98-7654321"`.

**Pass criterion:** Jane Smith in results with correct total.

**Edge case:** Receipt marked `paymentStatus: "unpaid"`. An unpaid vendor receipt should NOT count toward 1099 total (it was not actually paid in the tax year).

---

### 1099-003 — Contractor paid $1,200 across two receipts

**Seed data:**
- `admin/vendors/vendor-bob`: `{ name: "Bob Wilson", payeeType: "contractor", taxId: "45-6789012" }`
- `admin/purchaseReceipts/receipt-B1`: `{ vendorId: "vendor-bob", amountCents: 60000, receivedAt: "2026-01-15T00:00:00Z", paymentStatus: "paid" }`
- `admin/purchaseReceipts/receipt-B2`: `{ vendorId: "vendor-bob", amountCents: 60000, receivedAt: "2026-02-20T00:00:00Z", paymentStatus: "paid" }`

**Expected Output:** Bob Wilson appears once with `totalPaid: 120000` (two receipts summed).

**Pass criterion:** `totalPaid == 120000`. Bob appears exactly once (no duplicate per receipt).

**Edge case:** One receipt in 2026, one in 2025. Only 2026 receipts count. `totalPaid` must reflect 2026 only.

---

### 1099-004 — Contractor with no Tax ID on file

**Seed data:**
- `admin/vendors/vendor-alex`: `{ name: "Alex Brown", payeeType: "contractor", taxId: null }`
- `admin/purchaseReceipts/receipt-A1`: `{ vendorId: "vendor-alex", amountCents: 80000, receivedAt: "2026-03-10T00:00:00Z", paymentStatus: "paid" }`

**Expected Output:** Alex Brown appears in results but with `taxId: null, flag: "missing_tax_id"`. Must be clearly flagged, not silently omitted.

**Pass criterion:** Alex Brown is present with `flag: "missing_tax_id"`.

**Edge case:** Contractor with Tax ID = empty string `""` (not null). Must treat as missing, same as null.

---

### 1099-005 — Regular vendor (not contractor) does not appear

**Seed data:**
- `admin/vendors/vendor-sup`: `{ name: "ABC Supplies Co", payeeType: "vendor" }` (not contractor)
- `admin/purchaseReceipts/receipt-S1`: `{ vendorId: "vendor-sup", amountCents: 150000, receivedAt: "2026-04-01T00:00:00Z", paymentStatus: "paid" }`

**Expected Output:** "ABC Supplies Co" does NOT appear in 1099 results (it's a business vendor, not a contractor).

**Pass criterion:** `vendor-sup` is absent from the 1099 output regardless of payment amount.

**Edge case:** An employee (in `admin/employees/`) who is also referenced in a purchase receipt. Must not appear in 1099 results — payroll employees get W-2, not 1099.

---

## Section 7 — Cash Flow

### CF-001 — Cash flow snapshot with bank balance, AR, and AP

**Seed data:**
- `admin/plaidItems/item-001`: `{ institutionName: "First National Bank", accounts: [{ accountId: "acct-001", name: "Business Checking", type: "depository", currentBalance: 450000 }], status: "active" }`
- Open AR: order-W001 ($1,200 due 2026-05-20) from AR-001 seed
- Open AP: receipt-abc-001 ($800 due 2026-05-20) from AP-001 seed

**MCP Tool Call:**
```json
{ "tool": "finance_get_cash_flow", "arguments": { "tenantId": "sgtest15", "asOfDate": "2026-05-01" } }
```

**Expected Output:**
```json
{
  "asOfDate": "2026-05-01",
  "bankBalances": { "total": 450000, "accounts": [{ "name": "Business Checking", "balance": 450000 }] },
  "arOutstanding": { "total": 120000, "dueWithin30Days": 120000 },
  "apDue": { "total": 80000, "dueWithin30Days": 80000 },
  "netCashPosition": 490000
}
```
(Bank $4,500 + AR $1,200 - AP $800 = net $4,900)

**Pass criterion:** `bankBalances.total == 450000`, `arOutstanding.total == 120000`, `apDue.total == 80000`, `netCashPosition == 490000`.

**Edge case:** Multiple bank accounts at different institutions. Confirm balances are summed, not just one account returned.

---

### CF-002 — Cash flow with no bank connections

**Seed data:** No Plaid items connected for sgtest15.

**Expected Output:** `bankBalances: { total: 0, accounts: [] }`. AR and AP still shown if data exists. No error thrown.

**Pass criterion:** Valid response, bank section is empty, other sections still populated.

**Edge case:** A Plaid item with `status: "error"` (reconnect required). Must not include its balance in totals and should flag the item as stale/disconnected.

---

## Section 8 — Time Clock

Time clock data lives in `admin/timeClock/{entryId}`. Employee hourly rate read from `admin/employees/{empId}.payRate`.

**Seed employee:** `admin/employees/emp-001`: `{ fullName: "Alice Johnson", payType: "hourly", payRate: 1800, employmentType: "part-time", status: "active" }`

### TC-001 — Clock in (creates open entry)

**Seed data:** None (this test creates data).

**MCP Tool Call:**
```json
{ "tool": "team_clock_in", "arguments": { "tenantId": "sgtest15", "employeeId": "emp-001", "clockedInAt": "2026-04-07T09:00:00Z" } }
```

**Expected Output:** `{ entryId: "<generated>", employeeId: "emp-001", clockedInAt: "2026-04-07T09:00:00Z", clockedOutAt: null, hoursWorked: null, status: "open" }`

**Pass criterion:** Entry created with `clockedOutAt: null` and `status: "open"`. A Firestore/RTDB read of the created entry confirms its presence.

**Edge case:** Clocking in when an open entry already exists (forgot to clock out). Tool must reject with error `"employee already clocked in"` and return the existing open entry ID.

---

### TC-002 — Clock out (computes hours worked)

**Seed data:** Open entry `admin/timeClock/tc-entry-001`: `{ employeeId: "emp-001", clockedInAt: "2026-04-07T09:00:00Z", clockedOutAt: null, status: "open" }`

**MCP Tool Call:**
```json
{ "tool": "team_clock_out", "arguments": { "tenantId": "sgtest15", "employeeId": "emp-001", "entryId": "tc-entry-001", "clockedOutAt": "2026-04-07T17:00:00Z" } }
```

**Expected Output:** `{ entryId: "tc-entry-001", hoursWorked: 8.0, laborCostCents: 14400, status: "complete" }`

(8 hours × $18/hr = $144.00 = 14,400 cents)

**Pass criterion:** `hoursWorked == 8.0`, `laborCostCents == 14400`. Duration is wall-clock hours, not decimal hours rounded.

**Edge case:** Clock-in and clock-out span midnight (e.g., 10pm to 6am = 8 hours). Must compute correctly across day boundary.

---

### TC-003 — Open clock-in entry shows as "in progress"

**Seed data:** `admin/timeClock/tc-entry-002`: `{ employeeId: "emp-001", clockedInAt: "2026-04-08T09:00:00Z", clockedOutAt: null, status: "open" }`

**MCP Tool Call:**
```json
{ "tool": "team_get_time_entries", "arguments": { "tenantId": "sgtest15", "employeeId": "emp-001", "startDate": "2026-04-08", "endDate": "2026-04-08" } }
```

**Expected Output:** Entry with `status: "open"`, `clockedOutAt: null`, `hoursWorked: null` is returned.

**Pass criterion:** Open entry appears in results with status clearly indicating it is in-progress.

**Edge case:** Listing entries across a date range that includes the current day when there is an open entry. Open entry appears in list without causing an error.

---

### TC-004 — Weekly hours summary for an employee

**Seed data:** 5 completed clock entries for emp-001 in week of 2026-04-07 (Mon–Fri):
- `tc-mon`: `{ employeeId: "emp-001", date: "2026-04-07", hoursWorked: 6.0, status: "complete" }`
- `tc-tue`: `{ hoursWorked: 5.5, date: "2026-04-08" }`
- `tc-wed`: `{ hoursWorked: 7.0, date: "2026-04-09" }`
- `tc-thu`: `{ hoursWorked: 6.0, date: "2026-04-10" }`
- `tc-fri`: `{ hoursWorked: 4.0, date: "2026-04-11" }`

**MCP Tool Call:**
```json
{ "tool": "team_get_labor_cost", "arguments": { "tenantId": "sgtest15", "employeeId": "emp-001", "startDate": "2026-04-07", "endDate": "2026-04-13" } }
```

**Expected Output:** `{ totalHours: 28.5, laborCostCents: 51300, entryCount: 5 }`

(28.5 × 18 × 100 = 51,300 cents = $513.00)

**Pass criterion:** `totalHours == 28.5`, `laborCostCents == 51300`.

**Edge case:** Overtime threshold. If 28.5 hours is within the week and the employee's scheduled hours are 20/week, verify the tool does not flag overtime incorrectly (overtime should only trigger at > 40 hours/week per FLSA).

---

### TC-005 — Labor cost calculation (hours × hourly rate)

**Seed data:** Re-uses TC-004 entries. Also seed `admin/employees/emp-002`: `{ fullName: "Bob Smith", payType: "salary", payRate: 350000 }`.

**MCP Tool Call:**
```json
{ "tool": "team_get_labor_cost", "arguments": { "tenantId": "sgtest15", "employeeId": "emp-002", "startDate": "2026-04-01", "endDate": "2026-04-30" } }
```

**Expected Output:** For a salaried employee, `laborCostCents == 350000` (monthly salary regardless of hours logged). `totalHours` is informational only.

**Pass criterion:** Salary employees use monthly rate, not hours × rate. Result does not vary based on hours logged that month.

**Edge case:** Employee with `payType: "piece-rate"`. Confirm tool handles this gracefully — either compute correctly or return a clear error.

---

## Section 9 — PTO

PTO policy stored per employee. Two policy types: `fixed` (annual lump-sum grant) and `accrual` (earn hours as hours are worked).

### PTO-001 — Set annual grant policy (40 hours/year)

**Seed data:** emp-001 must exist (from TC tests above). No prior PTO policy.

**MCP Tool Call:**
```json
{
  "tool": "team_set_pto_policy",
  "arguments": {
    "tenantId": "sgtest15",
    "employeeId": "emp-001",
    "grantType": "fixed",
    "annualGrantHours": 40,
    "effectiveDate": "2026-01-01"
  }
}
```

**Expected Output:** `{ policyId: "<generated>", employeeId: "emp-001", grantType: "fixed", annualGrantHours: 40, balance: 40 }` (Initial balance = full grant since no usage yet.)

**Pass criterion:** Policy created. `balance == 40`.

**Edge case:** Setting a policy for an employee who already has one. Tool must replace/update, not create a duplicate.

---

### PTO-002 — Record 8 hours of PTO used

**Seed data:** PTO-001 policy must exist (40 hours).

**MCP Tool Call:**
```json
{ "tool": "team_record_pto", "arguments": { "tenantId": "sgtest15", "employeeId": "emp-001", "date": "2026-04-18", "hoursUsed": 8, "notes": "Vacation day" } }
```

**Expected Output:** `{ entryId: "<generated>", employeeId: "emp-001", hoursUsed: 8, newBalance: 32 }`

**Pass criterion:** Entry created. `newBalance == 32` (40 - 8).

**Edge case:** Recording PTO on a date in the past (e.g., 2026-01-15, before the test was run). Tool should allow backdated entries — managers often enter PTO retroactively.

---

### PTO-003 — Get current balance (should be 32)

**Seed data:** PTO-001 policy (40hr grant) + PTO-002 usage (8hr used) must exist.

**MCP Tool Call:**
```json
{ "tool": "team_get_pto_balance", "arguments": { "tenantId": "sgtest15", "employeeId": "emp-001" } }
```

**Expected Output:** `{ employeeId: "emp-001", grantType: "fixed", annualGrant: 40, used: 8, balance: 32 }`

**Pass criterion:** `balance == 32`. Balance is computed from `annualGrant - sum(usageEntries)`, not stored as a denormalized field that could drift.

**Edge case:** Employee with no PTO policy set. Must return a clear "no policy configured" message, not a zero balance (which would be misleading).

---

### PTO-004 — Accrual policy (1 hour per 40 hours worked)

**Seed data:**
- Set accrual policy for emp-001: `{ grantType: "accrual", accrualRateHoursPerHoursWorked: 0.025 }` (0.025 × 40 worked = 1 PTO hour)
- Log 40 hours worked (week of 2026-04-07, using TC-004 28.5hrs + more to total 40hrs): seed additional entry `tc-sat: { hoursWorked: 11.5, date: "2026-04-12" }`

**MCP Tool Call:**
```json
{ "tool": "team_get_pto_balance", "arguments": { "tenantId": "sgtest15", "employeeId": "emp-001" } }
```

**Expected Output:** `{ grantType: "accrual", hoursWorked: 40, accrued: 1.0, used: 0, balance: 1.0 }`

**Pass criterion:** `accrued == 1.0` (40 hours worked × 0.025 = 1 hour PTO earned). Balance reflects earned hours only.

**Edge case:** Fractional hours worked resulting in fractional PTO (e.g., 60 hours worked → 1.5 hours PTO). Confirm tool returns decimal balances, not truncated integers.

---

### PTO-005 — Balance cannot go negative

**Seed data:** emp-001 with 40hr fixed grant policy. 40 hours already used (per previous entries or fresh seed).

**MCP Tool Call:** Attempt to record 1 additional hour of PTO when balance is 0:
```json
{ "tool": "team_record_pto", "arguments": { "tenantId": "sgtest15", "employeeId": "emp-001", "date": "2026-05-01", "hoursUsed": 1 } }
```

**Expected Output:** Either (a) error response `{ error: "insufficient_pto_balance", balance: 0, requested: 1 }` or (b) success with a warning and `balance: -1` clearly flagged as negative.

**Pass criterion:** Tool does NOT silently record a negative balance without any indication. Either hard-block with error or soft-allow with explicit negative flag.

**Edge case:** Recording 0 hours of PTO. Tool must reject with a validation error — 0-hour PTO entry is meaningless data.

---

## Section 10 — Invoicing

Invoices generated from wholesale orders. Invoice status is independent of order status.

### INV-001 — Generate invoice from a wholesale order

**Seed data:** `orders/order-W001` must exist (from AR-001: $1,200, Blue Door Gallery, confirmed).

**MCP Tool Call:**
```json
{ "tool": "orders_create_invoice", "arguments": { "tenantId": "sgtest15", "orderId": "order-W001" } }
```

**Expected Output:**
```json
{
  "invoiceId": "<generated>",
  "invoiceNumber": "INV-2026-001",
  "orderId": "order-W001",
  "customerName": "Blue Door Gallery",
  "amountCents": 120000,
  "paidAmountCents": 0,
  "status": "draft",
  "issuedAt": "<timestamp>",
  "dueAt": "2026-05-20"
}
```

**Pass criterion:** Invoice created with `status: "draft"`, `amountCents == 120000`, linked to `order-W001`. `dueAt` matches order's `paymentDueDate`.

**Edge case:** Attempting to create an invoice for a non-wholesale order (e.g., a retail Square order). Must reject with error `"order is not wholesale"` or similar.

---

### INV-002 — Mark invoice as sent

**Seed data:** Invoice from INV-001 with `status: "draft"`.

**MCP Tool Call:**
```json
{ "tool": "orders_update_invoice_status", "arguments": { "tenantId": "sgtest15", "invoiceId": "<from INV-001>", "status": "sent" } }
```

**Expected Output:** `{ invoiceId: "...", status: "sent", sentAt: "<timestamp>" }`

**Pass criterion:** `status == "sent"`. `sentAt` timestamp is set.

**Edge case:** Sending an invoice that is already "paid". Must reject state transition with error — cannot go from paid back to sent.

---

### INV-003 — Mark invoice as paid

**Seed data:** Invoice from INV-001/INV-002 with `status: "sent"`.

**MCP Tool Call:**
```json
{ "tool": "orders_update_invoice_status", "arguments": { "tenantId": "sgtest15", "invoiceId": "<from INV-001>", "status": "paid", "paidAmountCents": 120000, "paidAt": "2026-05-15T00:00:00Z" } }
```

**Expected Output:** `{ status: "paid", paidAmountCents: 120000, paidAt: "2026-05-15T00:00:00Z", balance: 0 }`

**Pass criterion:** `status == "paid"`, `paidAmountCents == amountCents`, `balance == 0`.

**Edge case:** Partial payment: `paidAmountCents: 60000` (half of $1,200). Status should become `"partially_paid"`, not `"paid"`. Balance = 60000.

---

### INV-004 — Invoice lifecycle in AR aging

**Description:** Verify that an invoice appears in AR aging before payment and disappears after. Combines INV-001 (create invoice), INV-003 (mark paid), and AR-001 (query aging).

**Seed data:** order-W001 with generated invoice (from INV-001). Invoice is unpaid.

**Step A — Invoice unpaid, must appear in AR aging:**
Call `finance_get_ar_aging({ tenantId: "sgtest15", asOfDate: "2026-05-01" })`.
**Expected:** order-W001 / invoice appears in `current` bucket.

**Step B — Mark invoice paid (INV-003 call).** Then call `finance_get_ar_aging` again.
**Expected:** order-W001 / invoice does NOT appear in any bucket.

**Pass criterion:** Aging result changes between Step A and Step B. Paid invoice absent from Step B result.

**Edge case:** If AR aging reads directly from the orders collection (not the invoices collection), confirm that marking an invoice paid also updates the order's `paymentStatus` field.

---

## Section 11 — Loan / Investor Report

### LIR-001 — 12-month P&L summary

**Seed data:** Requires monthly revenue and expense data across 12 months (May 2025 – April 2026). At minimum, seed 3 months with distinct values:
- May 2025: revenue $800, expenses $600
- Oct 2025: revenue $1,200, expenses $900
- Apr 2026: revenue $1,000, expenses $700 (re-uses PNL-001 data)

**MCP Tool Call:**
```json
{ "tool": "finance_get_loan_report", "arguments": { "tenantId": "sgtest15", "startDate": "2025-05-01", "endDate": "2026-04-30" } }
```

**Expected Output:** Monthly breakdown array with 12 entries. Each entry has `month`, `revenue`, `expenses`, `netProfit`. A `summary` section shows: `totalRevenue`, `totalExpenses`, `totalNetProfit`, `avgMonthlyRevenue`, `grossMarginPct`.

**Pass criterion:** 12 entries in monthly array. Months with no data show zeros (not missing). Summary totals match sum of monthly values.

**Edge case:** Tenant with data for only 3 of 12 months. The 9 empty months must appear as zero-value entries in the monthly array, not be omitted.

---

### LIR-002 — Key metrics calculation

**Seed data:** Re-uses LIR-001 seed data. Assumes at least one month of COGS data (PNL-001 seed: $150 materials in April 2026).

**Expected Output (within LIR-001 response or separate):**
```json
{
  "grossMarginPct": 85.0,
  "netMarginPct": -70.0,
  "monthsOfRunway": "<bank balance / avg monthly burn>",
  "largestExpenseCategory": "payroll"
}
```

(April only figures from PNL-001: $1,000 revenue, $150 COGS → 85% gross margin; -$700 net → -70% net margin)

**Pass criterion:** `grossMarginPct == (revenue - cogs) / revenue * 100`. Calculation uses the period data, not hardcoded values. `largestExpenseCategory` correctly identifies payroll as the dominant line.

**Edge case:** Period with zero revenue (all-expense month). `grossMarginPct` and `netMarginPct` must return null or a descriptive error, not divide-by-zero.

---

## Seed Data Summary

**All records for tenant `sgtest15` unless noted. Create in this order (dependencies listed).**

### `admin/salesCache/` (or equivalent revenue store)

| ID | processor | totalAmount (¢) | processingFee (¢) | createdAt | orderSource |
|---|---|---|---|---|---|
| txn-001 | square | 50000 | 175 | 2026-04-10T14:00:00Z | online |
| txn-002 | square | 30000 | 117 | 2026-04-20T10:00:00Z | online |
| txn-003 | manual | 20000 | 0 | 2026-04-25T15:30:00Z | pos |
| txn-004 | square | 10000 | 39 | 2026-05-02T11:00:00Z | online |
| txn-march-01 | square | 30000 | 117 | 2026-03-15T10:00:00Z | online |
| txn-march-02 | manual | 10000 | 0 | 2026-03-20T14:00:00Z | pos |
| txn-march-03 | etsy | 20000 | 0 | 2026-03-22T09:00:00Z | etsy |

### `admin/expenses/`

| ID | amount (¢) | date | category | reviewed | merchantName |
|---|---|---|---|---|---|
| exp-001 | 15000 | 2026-04-08 | materials | true | Clay Supplier Co |
| exp-002 | 5000 | 2026-04-20 | software | true | Adobe |
| exp-003 | 10000 | 2026-04-22 | travel | false | (unreviewed — exclude from P&L) |
| exp-004 | 8000 | 2026-04-24 | shipping_supplies | true | Uline |

### `admin/journalEntries/`

| ID | date | description | amount (¢) | pnlLine | category |
|---|---|---|---|---|---|
| je-001 | 2026-04-30 | April payroll | 150000 | payroll | payroll |
| je-002 | 2026-04-28 | Kiln firing cost | 7500 | cogs | materials |

### `{tenantId}/orders/` — Wholesale AR orders

| ID | customerName | totalCents | paymentStatus | paymentDueDate | isWholesale |
|---|---|---|---|---|---|
| order-W001 | Blue Door Gallery | 120000 | unpaid | 2026-05-20 | true |
| order-W002 | Maple Leaf Ceramics | 50000 | unpaid | 2026-03-31 | true |
| order-W003 | Desert Sand Studio | 75000 | unpaid | 2026-02-25 | true |
| order-W004 | Northwoods Gifts | 20000 | unpaid | 2026-01-26 | true |
| order-W005 | River Arts | 90000 | paid | 2026-03-31 (paidAt: 2026-04-01) | true |
| order-W006 | Acme Gallery | 60000 | unpaid | 2026-04-11 | true |
| order-W007 | Acme Gallery | 40000 | unpaid | 2026-03-17 | true |

### `{tenantId}/orders/` — Sales tax orders

| ID | shippingState | subtotalCents | taxCents | status | placedAt |
|---|---|---|---|---|---|
| ORD-T001 | TX | 12500 | 1250 | delivered | 2026-03-05 |
| ORD-T002 | TX | 8750 | 875 | delivered | 2026-03-12 |
| ORD-T003 | TX | 5000 | 500 | delivered | 2026-03-18 |
| ORD-T004 | TX | 20000 | 2000 | delivered | 2026-04-10 |
| ORD-T005 | CA | 35000 | 3500 | delivered | 2026-04-15 |
| ORD-T006 | NY | 15000 | 1500 | delivered | 2026-04-20 |
| ORD-T007 | CO | 10000 | 0 | delivered | 2026-03-25 |

### `{tenantId}/orders/` — Economic Nexus orders (5 per state)

Create 5 orders each for WY ($9,000 each), CO ($17,000 each), TX ($25,000 each), CA ($25,000 each). Spread across Jan–Apr 2026. All `status: "delivered"`.

### `admin/vendors/`

| ID | name | payeeType | taxId |
|---|---|---|---|
| vendor-abc | ABC Supplies | vendor | null |
| vendor-xyz | XYZ Materials | vendor | null |
| vendor-pqr | PQR Distribution | vendor | null |
| vendor-john | John Doe | contractor | 12-3456789 |
| vendor-jane | Jane Smith | contractor | 98-7654321 |
| vendor-bob | Bob Wilson | contractor | 45-6789012 |
| vendor-alex | Alex Brown | contractor | null |
| vendor-sup | ABC Supplies Co | vendor | null |

### `admin/purchaseReceipts/`

| ID | vendorId | amountCents | paidAmountCents | paymentStatus | invoiceDueDate | receivedAt |
|---|---|---|---|---|---|---|
| receipt-abc-001 | vendor-abc | 80000 | 0 | unpaid | 2026-05-20 | 2026-04-22 |
| receipt-xyz-001 | vendor-xyz | 40000 | 0 | unpaid | 2026-03-31 | 2026-03-01 |
| receipt-xyz-002 | vendor-xyz | 50000 | 0 | unpaid | 2026-05-10 | 2026-04-25 |
| receipt-xyz-003 | vendor-xyz | 30000 | 0 | unpaid | 2026-04-01 | 2026-03-20 |
| receipt-pqr-001 | vendor-pqr | 100000 | 40000 | partial | 2026-05-15 | 2026-04-20 |
| receipt-J1 | vendor-john | 60000 | 60000 | paid | — | 2026-03-01 |
| receipt-J2 | vendor-jane | 60100 | 60100 | paid | — | 2026-04-01 |
| receipt-B1 | vendor-bob | 60000 | 60000 | paid | — | 2026-01-15 |
| receipt-B2 | vendor-bob | 60000 | 60000 | paid | — | 2026-02-20 |
| receipt-A1 | vendor-alex | 80000 | 80000 | paid | — | 2026-03-10 |
| receipt-S1 | vendor-sup | 150000 | 150000 | paid | — | 2026-04-01 |

### `admin/employees/`

| ID | fullName | payType | payRate (¢) | scheduledHoursPerWeek | employmentType | status |
|---|---|---|---|---|---|---|
| emp-001 | Alice Johnson | hourly | 1800 | 20 | part-time | active |
| emp-002 | Bob Smith | salary | 350000 | 40 | full-time | active |

### `admin/timeClock/`

| ID | employeeId | date | clockedInAt | clockedOutAt | hoursWorked | status |
|---|---|---|---|---|---|---|
| tc-entry-001 | emp-001 | 2026-04-07 | 2026-04-07T09:00:00Z | 2026-04-07T17:00:00Z | 8.0 | complete |
| tc-entry-002 | emp-001 | 2026-04-08 | 2026-04-08T09:00:00Z | null | null | open |
| tc-mon | emp-001 | 2026-04-07 | 2026-04-07T09:00:00Z | 2026-04-07T15:00:00Z | 6.0 | complete |
| tc-tue | emp-001 | 2026-04-08 | 2026-04-08T10:00:00Z | 2026-04-08T15:30:00Z | 5.5 | complete |
| tc-wed | emp-001 | 2026-04-09 | 2026-04-09T08:00:00Z | 2026-04-09T15:00:00Z | 7.0 | complete |
| tc-thu | emp-001 | 2026-04-10 | 2026-04-10T09:00:00Z | 2026-04-10T15:00:00Z | 6.0 | complete |
| tc-fri | emp-001 | 2026-04-11 | 2026-04-11T10:00:00Z | 2026-04-11T14:00:00Z | 4.0 | complete |

### `admin/pto/policies/`

| ID | employeeId | grantType | annualGrantHours | accrualRateHoursPerHoursWorked |
|---|---|---|---|---|
| policy-001 | emp-001 | fixed | 40 | — |

### `admin/nexusRegistrations/`

| stateCode | registered | registeredAt |
|---|---|---|
| CA | true | 2025-06-01 |

*(TX, CO, WY: no registration record)*

### `admin/plaidItems/`

| ID | institutionName | accounts | status |
|---|---|---|---|
| item-001 | First National Bank | `[{ accountId: "acct-001", name: "Business Checking", currentBalance: 450000 }]` | active |

---

## Open Questions

The following decisions must be made before Session 3 runs tests. The test case that depends on each question is noted.

1. **1099-001 — $600 boundary: inclusive or exclusive?**
   IRS 1099-NEC instructions say "paid $600 or more" — meaning $600.00 IS included. But some interpretations read "more than $600" as exclusive. Confirm: Does `finance_get_1099` include vendors paid exactly $600? Recommend: **include** (IRS inclusive). Test 1099-001 pass criterion must be updated to reflect the decision.

2. **NEX-001/NEX-002 — "Approaching" threshold definition**
   At what percentage of the $100K threshold should a state be flagged as `"approaching"` vs. `"below_threshold"`? Options: 75%, 80%, 85%. Recommend 75% ($75K or 150 transactions). The `flag` value in NEX-002 expected output must match the chosen threshold.

3. **NEX-001 — $100K boundary: inclusive or exclusive?**
   At exactly $100,000 in sales, is nexus triggered? IRS guidance typically uses "exceeds $100,000" (exclusive). Confirm: Does `finance_get_nexus` flag at `> $100,000` or `>= $100,000`? This affects NEX-001/NEX-002 boundary tests.

4. **PNL-001 — COGS definition for this platform**
   Does COGS include only `expenses.category == "materials"` and `journalEntries.pnlLine == "cogs"`, or also the cost of procurement receipts applied to sold products (from `admin/purchaseReceipts`)? If procurement costs flow to COGS, the P&L formula is significantly more complex. Recommend starting with expense-based COGS only (Phase 1) and adding procurement-based COGS in Phase 2.

5. **AR-006 — Per-invoice vs. per-customer aggregation in aging**
   Should AR aging return one line per invoice (order) or one line per customer with total outstanding? Or both? Recommend: per-invoice detail (preserves granularity) with an optional `customersummary` object that groups by `customerName`. Test AR-006 expected output must be updated once decided.

6. **INV-004 — AR aging data source: invoices collection vs. orders collection**
   Does `finance_get_ar_aging` read from `admin/invoices/` or directly from `{tenantId}/orders/` where `isWholesale: true`? If invoices are required for AR, then orders without a generated invoice are invisible to AR aging — which may be a bug. Recommend: AR aging reads orders directly; invoices are the formal document but do not gate AR tracking.

7. **PTO-005 — Hard-block vs. soft-allow negative PTO balance**
   Should recording PTO that exceeds the balance be a hard error (rejected) or a soft warning (allowed with negative balance flagged)? Recommend: **soft-allow with negative flag** — managers may approve "advance" PTO that will be earned back. Hard-block frustrates legitimate usage.

8. **CF-001 — netCashPosition formula**
   Is `netCashPosition = bankBalance + AROutstanding - APDue` or just `bankBalance - APDue` (AR is not cash yet)? Recommend separating: show bank balance, AR, and AP as three independent numbers rather than a net position — the net position formula choice is a user preference.

9. **Sales cache path and schema**
   The `financials.js` module syncs Square sales via the `salesSync` Cloud Function. Where does this data land in Firestore — `admin/salesCache/{txnId}` or another path? Session 3 must confirm the exact path before seeding revenue test data. If the path differs, all revenue-related seed data paths must be updated.
