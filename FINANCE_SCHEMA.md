# FINANCE_SCHEMA.md — Mast Finance Module

Data model reference for the Finance module. Documents all existing collections usable for Finance tabs, new collections to be created, document-level field additions, canonical query patterns, and open questions.

---

## 1. Existing Collections (Queryable — No Changes Required)

### `orders/{orderId}` → Revenue, P&L, Sales Tax, Cash Flow

Key fields available for Finance:

| Field | Type | Purpose |
|---|---|---|
| `total` | number (dollars) | Gross revenue per order |
| `subtotal` | number (dollars) | Pre-tax, pre-shipping revenue |
| `shippingCost` | number (dollars) | Shipping revenue |
| `tax` | number (dollars) | Tax collected |
| `taxRate` | number | Applied tax rate |
| `taxState` | string | State tax was collected in (Sales Tax by state) |
| `paidAmount` | number (dollars) | Amount received |
| `squarePaymentId` | string | Payment processor reference |
| `source` | string | `direct` / `etsy` / `wholesale` |
| `status` | string | Order status |
| `placedAt` | ISO timestamp | Date of sale |
| `createdAt` | ISO timestamp | Record creation |

MastDB entity: `MastDB.orders` → path `orders`, limit 100.

### `admin/sales/{saleId}` → Revenue, P&L

POS sales (Square in-person). Key fields:

| Field | Type | Purpose |
|---|---|---|
| `amount` | number (dollars) | Gross sale amount |
| `timestamp` or `createdAt` | ISO timestamp | Date of sale |
| `status` | string | `voided` to exclude from totals |
| `eventId` | string | Optional event linkage |
| `processingFee` | number (dollars) | Square fee |
| `tipAmount` | number (dollars) | Tip collected |

MastDB entity: `MastDB.sales` → path `admin/sales`, limit 200.

### `admin/expenses/{expenseId}` → P&L, Cash Flow, 1099 Prep

| Field | Type | Purpose |
|---|---|---|
| `amount` | number (cents) | Expense amount |
| `date` | YYYY-MM-DD | Expense date |
| `merchantName` | string | Payee name |
| `category` | string | `materials` / `booth_fee` / `shipping_supplies` / `travel` / `marketing` / `equipment` / `software` / `payroll` / `taxes` / `other` / `personal` |
| `businessLine` | string | `production` / `sculpture` / `general` |
| `isStudioOverhead` | boolean | Overhead flag for P&L allocation |
| `source` | string | `plaid` / `csv_import` / `manual` |
| `reviewed` | boolean | User-confirmed categorization |

MastDB entity: `MastDB.expenses` → path `admin/expenses`, limit 200.

### `admin/vendors/{vendorId}` → 1099 Prep, AP Aging

| Field | Type | Purpose |
|---|---|---|
| `name` | string | Vendor legal name |
| `taxId` | string | EIN/SSN for 1099 filing |
| `vendorCode` | string | Internal code |
| `defaultPaymentTerms` | string | Net-30, etc. |

MastDB entity: `MastDB.vendors` → path `admin/vendors`, limit 100.

### `admin/purchaseOrders/{poId}` → AP Aging, Cash Flow

| Field | Type | Purpose |
|---|---|---|
| `poNumber` | string | PO reference |
| `vendorId` | string | FK to vendors |
| `status` | string | `draft` / `submitted` / `partially_received` / `received` / `closed` / `cancelled` |
| `total` | number (dollars) | PO total |
| `orderDate` | ISO timestamp | PO issued date |
| `expectedDate` | string | Expected delivery |
| `paymentTerms` | string | Payment terms |

MastDB entity: `MastDB.purchaseOrders` → path `admin/purchaseOrders`, limit 100.

### `admin/purchaseReceipts/{receiptId}` → AP Aging (extended — see Section 3)

| Field | Type | Purpose |
|---|---|---|
| `receiptId` | string | Receipt ID |
| `poId` | string | FK to purchaseOrders |
| `receivedAt` | ISO timestamp | Receipt date |
| `vendorInvoiceRef` | string | Vendor's invoice number |
| `lines[]` | array | Line items received |
| `additionalCosts[]` | array | Freight, duties, etc. |
| `landedCostsApplied` | boolean | Whether landed costs are allocated |

MastDB entity: `MastDB.purchaseReceipts` → path `admin/purchaseReceipts`, limit 100.

### `admin/employees/{employeeId}` → Time Clock, PTO, Payroll Reporting

| Field | Type | Purpose |
|---|---|---|
| `fullName` | string | Employee name |
| `employmentType` | string | `full-time` / `part-time` / `temp` / `contractor` |
| `payRate` | number (cents) | Hourly or salary rate |
| `payType` | string | `hourly` / `salary` / `piece-rate` |
| `scheduledHoursPerWeek` | number | For PTO accrual calculations |
| `status` | string | `active` / `terminated` |

MastDB entity: `MastDB.employees` → path `admin/employees`, limit 100.

### `admin/plaidItems/{itemId}` → Bank Sync context (metadata only)

Stores connected bank account metadata. Does **not** cache balances — live balance requires Plaid API call at query time.

| Field | Type | Purpose |
|---|---|---|
| `institutionName` | string | Bank name |
| `status` | string | Sync status |
| `lastSyncAt` | ISO timestamp | Last sync time |
| `accounts[]` | array | Each: `accountId`, `name`, `mask`, `type`, `subtype` |

---

## 2. New Collections

### `admin/journalEntries/{id}` — Manual P&L / Adjustment Entries

Captures payroll imports, depreciation, owner draws, and any adjustments that don't flow through `orders/` or `admin/expenses/`.

```
{
  id:          string       // auto-generated
  date:        string       // YYYY-MM-DD
  description: string       // free text
  category:    string       // payroll / depreciation / owner-draw / cogs-adjustment / other
  amount:      number       // cents, always positive
  type:        string       // 'debit' | 'credit'
  source:      string       // 'manual' | 'payroll-import' | 'depreciation' | 'owner-draw'
  period:      string       // YYYY-MM  (for P&L period grouping)
  createdAt:   ISO timestamp
  updatedAt:   ISO timestamp
}
```

MastDB entity to add: `MastDB.journalEntries` → path `admin/journalEntries`, limit 200.

Indexes needed (Firestore composite):
- `date` ASC (for date-range queries)
- `period` + `type` (for P&L period roll-up)
- `source` + `date` (for import deduplication)

### `admin/timeEntries/{id}` — Employee Time Clock

Records clock-in/out events per employee. `hoursWorked` is computed at write time when the entry is closed.

```
{
  id:          string       // auto-generated
  employeeId:  string       // FK to admin/employees
  clockIn:     ISO timestamp
  clockOut:    ISO timestamp | null  // null = currently clocked in
  hoursWorked: number       // computed: (clockOut - clockIn) in hours; null while open
  date:        string       // YYYY-MM-DD (date of clockIn)
  notes:       string       // optional
  status:      string       // 'active' | 'complete' | 'adjusted'
  createdAt:   ISO timestamp
  updatedAt:   ISO timestamp
}
```

MastDB entity to add: `MastDB.timeEntries` → path `admin/timeEntries`, limit 200.

Indexes needed:
- `employeeId` + `date` ASC (per-employee hours by date)
- `date` ASC (all-employee daily roll-up)
- `status` + `date` (find open clock-in records)

### `admin/ptoPolicy/{id}` — PTO Accrual Rules Per Employee

One document per employee (or a default `employeeId: 'default'` document for org-wide policy).

```
{
  id:              string       // auto-generated, or employeeId for lookup
  employeeId:      string       // FK to admin/employees, or 'default'
  accrualType:     string       // 'hourly' | 'annual-grant' | 'none'
  accrualRate:     number       // hours of PTO per hour worked (if hourly)
                                //   OR total hours granted per year (if annual-grant)
  maxBalance:      number       // max hours that can be held (hours)
  carryoverLimit:  number | null  // max hours that carry into next year; null = unlimited
  effectiveDate:   string       // YYYY-MM-DD
  createdAt:       ISO timestamp
  updatedAt:       ISO timestamp
}
```

MastDB entity to add: `MastDB.ptoPolicy` → path `admin/ptoPolicy`, limit 50.

### `admin/nexusRegistrations/{stateCode}` — Sales Tax Nexus Registration Status

Tracks which states the tenant has registered for sales tax collection. One document per state code (e.g., `CA`, `TX`). Written by admin when they register with a state tax authority.

```
{
  state:        string       // two-letter state code
  registered:   boolean      // true = actively registered
  registeredAt: ISO timestamp // when registration took effect
  notes:        string       // optional admin notes
  updatedAt:    ISO timestamp
}
```

MastDB entity to add: `MastDB.nexusRegistrations` → path `admin/nexusRegistrations`, limit 60.

---

### `admin/ptoEntries/{id}` — PTO Accrual and Usage Log

Running ledger of PTO transactions. `balance` is the running total after this entry (maintained by the write path; avoids recomputing from scratch on every query).

```
{
  id:         string       // auto-generated
  employeeId: string       // FK to admin/employees
  type:       string       // 'accrual' | 'used' | 'adjustment'
  hours:      number       // positive for accrual/adjustment; negative for used
  date:       string       // YYYY-MM-DD
  notes:      string       // optional (e.g., "Annual grant", "Vacation 5/5–5/9")
  balance:    number       // running PTO balance in hours after this entry
  createdAt:  ISO timestamp
}
```

MastDB entity to add: `MastDB.ptoEntries` → path `admin/ptoEntries`, limit 200.

Indexes needed:
- `employeeId` + `date` ASC (per-employee PTO history)
- `employeeId` + `type` + `date` (accrual vs. usage split)

---

## 3. Modified Documents (Additive Field Additions)

### `orders/{orderId}` — Invoice / AR Fields

Add these optional fields to support AR aging and invoice tracking on wholesale/Net-30 orders. All fields are optional; absence = not invoiced.

| Field | Type | Default | Purpose |
|---|---|---|---|
| `invoiceStatus` | string | _(absent)_ | `draft` / `sent` / `paid` / `overdue` |
| `invoiceNumber` | string | _(absent)_ | Tenant-issued invoice number (e.g., `INV-0042`) |
| `invoiceSentAt` | ISO timestamp | _(absent)_ | When invoice was emailed to customer |
| `invoiceDueDate` | YYYY-MM-DD | _(absent)_ | Payment due date |
| `invoicePaidAt` | ISO timestamp | _(absent)_ | When payment was received |

No migration required — absent fields are treated as not-invoiced. The AR aging query filters on `invoiceStatus` presence and value.

### `admin/purchaseReceipts/{receiptId}` — AP Payment Tracking Fields

Add these optional fields to support AP aging. `paymentStatus` defaults to `'unpaid'` when absent.

| Field | Type | Default | Purpose |
|---|---|---|---|
| `paymentStatus` | string | `'unpaid'` | `unpaid` / `paid` / `partial` |
| `dueDate` | YYYY-MM-DD | _(absent)_ | Invoice due date (derived from PO `paymentTerms`) |
| `paidAt` | ISO timestamp | _(absent)_ | Date payment was made |
| `paidAmount` | number (cents) | _(absent)_ | Amount paid (for partial payments) |

No migration required. AP aging query uses `paymentStatus != 'paid'` or absence of `paymentStatus`.

---

## 4. Query Patterns

### P&L — Revenue Side
```javascript
// Orders revenue in period
MastDB.orders.query([
  ['placedAt', '>=', startDate],
  ['placedAt', '<=', endDate],
  ['status', '!=', 'cancelled']
])

// POS sales in period
MastDB.sales.query([
  ['createdAt', '>=', startDate],
  ['createdAt', '<=', endDate]
])
// Filter out voided: .filter(s => s.status !== 'voided')
```

### P&L — Expense Side
```javascript
MastDB.expenses.query([
  ['date', '>=', startDate],
  ['date', '<=', endDate]
])
// Sum by category; exclude category === 'personal'

// Journal adjustments in period
MastDB.journalEntries.query([
  ['period', '==', 'YYYY-MM']
])
```

### AR Aging
```javascript
// All open invoices
MastDB.orders.query([
  ['invoiceStatus', 'in', ['sent', 'overdue']]
])
// Bucket by: (today - invoiceDueDate) in days → Current / 1-30 / 31-60 / 61-90 / 90+
```

### AP Aging
```javascript
// Unpaid receipts
MastDB.purchaseReceipts.query([
  ['paymentStatus', 'in', ['unpaid', 'partial']]
])
// Join to purchaseOrders for vendorId, then to vendors for name/taxId
```

### Sales Tax by State
```javascript
MastDB.orders.query([
  ['placedAt', '>=', startDate],
  ['placedAt', '<=', endDate]
])
// Group by taxState; sum tax field per state
// Filter: taxState is set and tax > 0
```

### 1099 Prep
```javascript
// Get all vendors with taxId set
MastDB.vendors.list()
// For each vendor with taxId, sum receipts for the year:
MastDB.purchaseReceipts.query([
  ['vendorId', '==', vendorId],
  ['receivedAt', '>=', yearStart],
  ['receivedAt', '<=', yearEnd]
])
// Sum receipt line totals + additionalCosts; report if >= $600
```

### Time Clock — Hours Per Employee Per Period
```javascript
MastDB.timeEntries.query([
  ['employeeId', '==', employeeId],
  ['date', '>=', startDate],
  ['date', '<=', endDate],
  ['status', '!=', 'active']  // exclude open entries
])
// Sum hoursWorked
```

### PTO Balance (Current)
```javascript
// Most recent ptoEntry for employee = current balance
MastDB.ptoEntries.query([
  ['employeeId', '==', employeeId]
], { orderBy: 'date', direction: 'desc', limit: 1 })
// .balance field is the running total
```

### Cash Flow
```javascript
// Inflows: orders + sales (receipts from customers)
// Outflows: expenses (Plaid bank debits) + paid purchaseReceipts
// Bank position: requires live Plaid API call via Cloud Function
//   (account balances are NOT cached in admin/plaidItems/)
```

---

## 5. Open Questions

### Q1 — Cash Flow: Bank Account Balances
`admin/plaidItems/` stores account metadata but not cached balance amounts. The current sync functions (`syncPlaidTransactions`) only pull transactions, not balances. A Cash Flow tab that shows ending bank position requires either:
- (a) A new Cloud Function that calls Plaid's `/accounts/balance/get` and caches the result (introduces staleness risk), or
- (b) Fetching balances live from Plaid on each Cash Flow page load (latency ~1–2s, requires Plaid credentials per tenant), or
- (c) Accepting that Cash Flow shows transaction-derived net change only (no absolute position).

**Decision needed before building Cash Flow tab UI.**

### Q2 — Invoice Numbers: Sequence Generation
`invoiceNumber` on `orders/` is a string (e.g., `INV-0042`). Generating a globally sequential, tenant-scoped invoice number requires either a Firestore counter document (with transaction) or a Cloud Function. Client-side generation risks collisions. **Sequence generation approach not yet decided.**

### Q3 — PTO Accrual: Automated vs. Manual
The `admin/ptoEntries/` schema supports both automated accrual (computed from `timeEntries`) and manual entry. Automated accrual requires a Cloud Function triggered periodically or on time entry close. **Whether automated accrual is in scope for Phase 1 UI is not decided.**

### Q4 — Journal Entry Deduplication
`admin/journalEntries/` has a `source` field but no external reference ID for deduplication on import. If payroll imports are batched, re-importing may create duplicates. A `sourceRef` field (e.g., payroll batch ID) would prevent this. **Not added yet — add if payroll import is in scope.**

### Q5 — Partial PO Payments
`admin/purchaseReceipts/paymentStatus: 'partial'` with `paidAmount` (cents) covers partial AP payment, but the schema doesn't link to which receipt lines are paid vs. unpaid. For AP aging purposes, is line-level payment tracking needed, or is receipt-level sufficient? **Assumed receipt-level is sufficient for Phase 1.**
