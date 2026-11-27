# Payroll page for selected admins

| Field | Value |
|---|---|
| Date | 2026-11-27 |
| Author | Jayasoorya, with Claude Code (Claude Sonnet 5.5) |
| Issue / PR | none / pull request into `develop` (see the PR) |
| Branch | `feat/payroll-for-selected-admins` (from `develop`) |
| Type / scope | `feat(payroll)` |
| Files touched | Backend: `migrations/2026-11-27-admin-payroll-access.sql` and `.rollback.sql` (new), `middlewares/requirePayrollAccess.js` (new), `routes/payrollRoutes.js`, `routes/adminRoutes.js`, `controllers/admin/addAdminController.js`, `services/admin/dbQueries.js`, `services/account/accountDeletion.js`, `tests/payrollAccess.test.js` (new), `tests/payrollRoutesAccess.test.js`. Frontend: `routes/admin/PayrollRoute.jsx` and its test (new), `components/Admin/payroll/usePayrollAccess.js` (new), `App.jsx`, `reuse/Nav.jsx`, `reuse/AdminsList.jsx`, `reuse/AdminsList.invoices.test.jsx`, `components/Admin/Payroll.test.jsx`. This entry. |
| Reserved files touched | None. |

**What and why.** The owner asked for the Payroll page to be usable by admins the super admin chooses, like Invoices. Chosen: full use, own cities only.

- New per-admin switch `admin.can_use_payroll` (off for everyone). The super admin turns it on or off in the admins list (a "Payroll" column next to "Invoices"), through `PATCH /admin/toggle-admin-payroll/:id`. The Invoices and Payroll switches now share one controller (`toggleAdminAccess`); the Invoices answers are unchanged.
- The Payroll page's routes (ledger: list, add, edit, void, history, repayments and their reversal; a driver's statements and balances; one statement) moved from "super admin only" to `requirePayrollAccess`: the super admin, or an active admin with the switch on, read from the database on every request. The role the services use is the database's, not the token's. `GET /admin/payroll/access` tells the menu and the page.
- What an admin may do there is unchanged and checked in the services, as they were written for (#142, #145, #166): only the cities assigned to them; waivers (and reversing one) stay super admin only. Pay runs, payments, Everee, QuickBooks, Insights and Statements stay super admin only.
- Frontend: `PayrollRoute` (like `InvoiceRoute`) instead of the super admin guard for `/admin/payroll`; the menu shows Payroll to those admins.
- Completing an account deletion now also switches Payroll off for that admin.

**Database.** `ALTER TABLE admin ADD COLUMN IF NOT EXISTS can_use_payroll boolean NOT NULL DEFAULT false;` Rollback: `ALTER TABLE admin DROP COLUMN IF EXISTS can_use_payroll;` **Run it before deploying the backend** (the admins list and the access check read the column). Applied to the local development database only.

**Config and dependencies.** None. **Money impact.** None: no pay, rate or deduction rule changed. Who may enter ledger entries widens to the chosen admins, for their own cities.

**Tested.** Backend 390 pass. New `payrollAccess.test.js`: who has access (super admin; admin switched on; refused when switched off, disabled, unknown, or a driver token; an old super admin token gets the saved role), the switch (super admin in the database only, wanted value saved, bad input refused), and on a local database copy (`PAYROLL_TEST_DB=1`, rolled back): the switch is saved, and a switched-on admin adds a hand-entered claim in their own city and is refused for another city, for adding and listing. `payrollRoutesAccess.test.js` now checks every Payroll page route carries `requirePayrollAccess` and every other payroll route stays behind the super admin guard. Frontend 674 pass, including `PayrollRoute` (on: opens; off: dashboard; super admin: no question) and the Payroll switch in the admins list. **Not tested:** in a browser.
