# Finance + Team MCP Tool Permission Matrix

Reference document for Session 3 when implementing Finance and Team MCP tools.
Defines the `requiredPermission` annotation for each tool using the entity-action
model established by RBAC Phases 5–6 (gitSha `fea54eb`).

---

## Annotation Pattern

Each tool in a skill file carries:
```ts
requiredPermission: { entity: "finance", action: "read" }
```
`null` = open tool (no auth required beyond session).
See `src/shared/tools/sessions.ts` → `checkPermission()`.

---

## Finance Entity in DEFAULT_ROLES

Added in this session (RBAC audit). The `finance` entity encodes:

| Role    | create | read  | update | delete |
|---------|--------|-------|--------|--------|
| admin   | true   | true  | true   | true   |
| manager | true   | true  | true   | false  |
| user    | false  | false | false  | false  |
| guest   | false  | false | false  | false  |

**Key:** `delete: true` on admin only is the sentinel used by `navigateTo()` to gate the
P&L, Tax, and Reports routes. `finance.delete` = "can access sensitive financial reports."

---

## Finance Tools

### Revenue / Expenses / Cash Flow / AR / AP
Audience: Admin + Manager (`finance.read`)

| Tool name (proposed)         | Entity   | Action | Notes                              |
|------------------------------|----------|--------|------------------------------------|
| `finance_get_revenue`        | finance  | read   | Revenue summary, date-range filter |
| `finance_get_expenses`       | finance  | read   | Expense totals by category         |
| `finance_get_cashflow`       | finance  | read   | Net cash position over period      |
| `finance_get_ar_aging`       | finance  | read   | Accounts receivable aging buckets  |
| `finance_get_ap_aging`       | finance  | read   | Accounts payable aging buckets     |

### P&L / Tax / Reports
Audience: Admin only (`finance.delete` — see sentinel note above)

| Tool name (proposed)         | Entity   | Action | Notes                                   |
|------------------------------|----------|--------|-----------------------------------------|
| `finance_get_pnl`            | finance  | delete | Full P&L statement; Admin-only          |
| `finance_get_tax_summary`    | finance  | delete | Tax liability summary; Admin-only       |
| `finance_get_nexus_status`   | finance  | delete | Sales-tax nexus by state; Admin-only    |
| `finance_get_1099_prep`      | finance  | delete | 1099 contractor payment list; Admin-only|
| `finance_get_loan_report`    | finance  | delete | Loan/investor report data; Admin-only   |

> **Note on sentinel pattern:** Using `finance.delete` as the Admin-only gate is
> intentional and consistent with the existing RBAC model (no row-level filtering,
> entity-action pairs only). If the semantics feel wrong, the cleanest fix for Session 3
> is to add a `financeSensitive` entity with `admin: read=true, manager: read=false`.
> That would let annotations use `{ entity: "financeSensitive", action: "read" }`.
> Flag as OPEN before implementing.

---

## Team Tools

### Time Clock

| Tool name (proposed)          | Entity | Action | Notes                                            |
|-------------------------------|--------|--------|--------------------------------------------------|
| `team_clock_in`               | jobs   | update | Self-clock: any role (future). Use `null` when   |
|                               |        |        | self-service mode is built. For now: jobs.update |
| `team_clock_out`              | jobs   | update | Same as clock_in                                 |
| `team_get_time_entries`       | jobs   | read   | Manager: all entries. Future: own-only for User. |
|                               |        |        | Row-level filtering is blocked by CONSTRAINT.    |
|                               |        |        | Gate at jobs.read for now (admin/manager only).  |

### PTO

| Tool name (proposed)          | Entity | Action | Notes                                           |
|-------------------------------|--------|--------|-------------------------------------------------|
| `team_get_pto_balance`        | jobs   | read   | Same self-vs-others caveat as time entries      |
| `team_set_pto_policy`         | users  | update | Admin-only: sets accrual rates, carry-over rules|
| `team_approve_pto_request`    | jobs   | update | Manager+: approve/deny PTO requests             |

---

## OPEN: Self-Service Access for Time Clock and PTO

The intended UX has employees viewing their own time/PTO via the Team module.
The CONSTRAINT blocks row-level data filtering ("RBAC is role-level only").
Before Session 3 implements `team_get_time_entries` and `team_get_pto_balance`,
a design decision is needed:

**Option A — Role-level only (current model):** Tools return all records for manager+,
blocked entirely for user/guest. No self-service.

**Option B — Caller-scoped tools:** Add separate `team_get_my_time_entries` and
`team_get_my_pto_balance` tools that always scope to the calling session's UID.
These are not "row-level filtering" on a query — the tool scope IS the filter. Maps
cleanly onto the existing entity-action model (`requiredPermission: null` or a new
`team.read` entity). This is the recommended path.

Flag this as an OPEN for Session 3 to resolve before coding.

---

## jobs Entity in DEFAULT_ROLES (existing)

Used as the Admin/Manager gate for Team module tabs. Values as of this session:

| Role    | create | read  | update | delete |
|---------|--------|-------|--------|--------|
| admin   | true   | true  | true   | true   |
| manager | true   | true  | true   | false  |
| user    | false  | false | false  | false  |
| guest   | false  | false | false  | false  |

`jobs.read` = "can manage staff operations" — the gate used by `canManageTeam()`
in `app/modules/team.js` to show/hide the Time Clock, PTO, Documents, and Onboarding tabs.

---

## Finance Nav Section — Role Access Summary

| Tab         | Admin | Manager | User | Guest |
|-------------|-------|---------|------|-------|
| Revenue     | ✓     | ✓       | —    | —     |
| Expenses    | ✓     | ✓       | —    | —     |
| P&L         | ✓     | —       | —    | —     |
| Cash Flow   | ✓     | ✓       | —    | —     |
| AR          | ✓     | ✓       | —    | —     |
| AP          | ✓     | ✓       | —    | —     |
| Tax         | ✓     | —       | —    | —     |
| Reports     | ✓     | —       | —    | —     |

Manager block on P&L/Tax/Reports is enforced in `navigateTo()` via `finance.delete` gate.
Finance section is hidden at nav level for User/Guest via `DEFAULT_NAV_SECTIONS`.

## Team Module — Role Access Summary

| Tab         | Admin | Manager | User | Guest |
|-------------|-------|---------|------|-------|
| Roster      | ✓     | ✓       | *    | *     |
| Time Clock  | ✓     | ✓       | —    | —     |
| PTO         | ✓     | ✓       | —    | —     |
| Documents   | ✓     | ✓       | —    | —     |
| Onboarding  | ✓     | ✓       | —    | —     |

`*` — User/Guest cannot currently reach the Team page (Operations not in their navSections).
Future self-service Roster access is expected; the tab-level guards are in place for when
that happens.
