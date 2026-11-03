# Read-only pay statements and balances for drivers and admins (issue #145, part 1)

- **Date:** 2026-11-03
- **Author:** Jayasoorya (with Claude Code)
- **Issue / PR:** #145 (part of #138) / see the pull request for this branch. Stacked on #152 (pay runs), which is stacked on #147 → #148 → #149.
- **Branch:** `feat/payroll-statements` (from `feat/payroll-pay-runs`)
- **Type and scope:** feat(payroll)
- **Files touched:**
  - new: `Backend/services/payroll/statements/statementStore.js`, `Backend/controllers/payroll/statementController.js`, test `Backend/tests/statementStore.test.js`;
  - changed: `Backend/routes/driverRoutes.js` and `Backend/routes/payrollRoutes.js` (new read-only routes), `Backend/services/payroll/payRuns/payRunStore.js` (exports its existing city check so it is not copied a third time);
  - this journal entry.

  No reserved files are edited. `payment_dashboard` (Jasil's zone) is only **read**, to name the route of each earning line.

**What and why.** Drivers and admins can now read the frozen pay statements that #143 makes, and each driver's outstanding balances. Every amount comes from the stored statement rows; nothing is recalculated, so there is no second payroll formula.

New routes, all `GET`:

| Who | Route | Returns |
|---|---|---|
| driver | `/driver/payroll/statements` | the driver's own statements, newest first (100 at most) |
| driver | `/driver/payroll/statements/:statementId` | one statement with its lines |
| driver | `/driver/payroll/balances` | ledger entries and matched claims with original, taken and outstanding amounts and the pay runs that took them |
| admin, super admin | `/admin/payroll/drivers/:driverId/statements?cityId=` | that driver's statements in the city |
| admin, super admin | `/admin/payroll/statements/:statementId` | one statement with its lines |
| admin, super admin | `/admin/payroll/drivers/:driverId/balances?cityId=` | the same balances, limited to the city |

Who sees what:
- **Drivers** see only their own statements. The driver ID comes from the verified token; there is no driver ID in the URL. They see only finalized and voided runs, never a draft. Someone else's statement answers 404, the same as a missing one.
- **City admins** must name one of their cities (400 without one, 403 for another city). A super admin may leave the city out. Admins also see drafts, marked `pending`.
- **Unmatched claims** belong to nobody yet and are never shown to a driver.

Each statement carries a `state`, so the stages are never mixed up: `pending` (draft), `approved` (finalized, not sent), `submitted`, `paid`, `failed`, `unconfirmed` (from the payout fields #31 will fill), or `voided`. A voided statement stays visible as voided; corrections appear as later ledger entries, never as an edit.

Each line names its source:
- earnings and insurance: the day and route;
- claim lines: courier, waybill, claim type, the carrier's original charge, and the amount actually deducted on this statement (for an amended claim, only the difference);
- recovery and reimbursement lines: the ledger entry, its type, reason, original amount and repayment plan.

Balances show, per ledger entry and per matched claim, the original amount, what finalized runs took, what is still outstanding, and the pay runs that took it. An exempt claim (DFW / Dallas GOFO and Tracking interruption) or exempt entry shows 0 taken and 0 outstanding, next to the carrier's original charge. `owedByDriver` subtracts repayments made outside payroll; `owedToDriver` is reimbursements not yet paid.

- **Database:** None. Read-only; no new tables, columns or indexes.
- **Config and dependencies:** None.
- **Money impact:** None. Nothing is written; amounts shown are the stored statement amounts. In the test, the statement read back equals what the run stored: gross 200.00, insurance 3.84, claim 40.00, recovery 50.00, net 106.16.

**Tested.**
- `Backend/tests/statementStore.test.js` against a local copy (`nasa_local`), inside one transaction that is always rolled back, migrations included. It covers:
  - a draft is hidden from the driver and pending for the admin;
  - a finalized statement with its sources;
  - another driver gets 404, and a wrong-city or no-city admin is refused;
  - balances with original, taken, outstanding and linked run;
  - an exempt claim shows 0;
  - a voided run stays visible and its deductions count as owed again.
- Full backend suite: 86 pass with the database, 52 pass without it (CI mode), 0 fail.
- By hand over HTTP on a local backend (port 5003, `nasa_local` with the three payroll migrations applied, removed afterwards), with tokens for made-up IDs:
  - no token: 401;
  - an admin token on a driver route, or a driver token on an admin route: 403;
  - own list and balances: 200;
  - a bad statement ID: 400;
  - a missing one: 404;
  - an admin without a city: 400;
  - another city: 403;
  - a bad `cityId`: 400;
  - a super admin across all cities: 200.

**Not tested.** Real production data. The screens (next pull request). Large drivers with more than 100 statements (the list stops at 100).

**Risks and follow-ups.** The screens for drivers (EN/ES, phone layout) and admins come next under #145. Repayments made outside payroll are subtracted from the driver's total, not from a single entry, because the calculator spreads them over the oldest debts at each run.
