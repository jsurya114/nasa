# Invoices for selected admins

| Field | Value |
|---|---|
| Date | 2026-11-16 |
| Author | Jayasoorya Suryadas, with Claude Code (Claude Sonnet 5.5) |
| Issue / PR | none / see the pull request |
| Branch | `feat/invoices-for-selected-admins` |
| Type / scope | `feat(backend)` and `feat(frontend)` |
| Files touched | Backend: `middlewares/requireInvoiceAccess.js` (new), `routes/invoiceRoutes.js`, `controllers/invoices/invoiceController.js`, `services/invoices/invoiceStore.js`, `routes/adminRoutes.js`, `controllers/admin/addAdminController.js`, `services/admin/dbQueries.js`, migration `2026-11-16-admin-invoice-access` (+ rollback); tests `invoiceAccess` (new), `invoiceRules`. Frontend: `routes/admin/InvoiceRoute.jsx` (new), `components/Admin/invoice/useInvoiceAccess.js` (new), `reuse/Nav.jsx`, `reuse/AdminsList.jsx`, `App.jsx`, `redux/slice/admin/userLoadSlice.js`; tests. Journal entry. |
| Reserved files touched | None. The sign-in code (`adminSlice`, `axiosInstance`, route guards `ProtectedRoutes`) is not changed. |

**What and why.** Invoices were for the super admin only. The super admin can now switch Invoices on for single ordinary admins.

- **The switch.** New column `admin.can_use_invoices`, off for everyone. The Administrators list has an "Invoices" column: a switch for each ordinary
  admin (a super admin shows "Always"). It calls `PATCH /admin/toggle-admin-invoices/:id`, super admin only, ordinary admins only.
- **Access.** `requireInvoiceAccess` replaces the old super-admin-only guard on `/admin/invoices`. The super admin always passes; an ordinary admin
  passes only if the switch is on and the admin is active. The switch is read from the database on every request, not from the token, so switching it
  off takes effect at once. `GET /admin/invoices/access` (any signed-in admin) answers whether the current admin has access, for the menu and the page.
- **What a selected admin may do.** Everything the super admin can on Invoices: create and edit invoices, manage the saved vendors, record a payment
  received and see the history.
- **Only their own invoices.** A selected admin sees, opens, edits and records payment only on invoices they created (`created_by`). Another admin's
  invoice answers "not found". The list and its search are limited the same way. The super admin sees all. Saved vendors are shared by everyone who has
  Invoices (a vendor name is unique, so two admins cannot each create the same one).
- **Menu and page.** The Invoices link and the page follow the server's answer. Insights is still super admin only (it counts all invoices).
- `userLoadSlice`: enabling or disabling an admin now merges the short answer into the row instead of replacing it, so the row keeps its cities and
  its Invoices switch.

**Database.** `Backend/migrations/2026-11-16-admin-invoice-access.sql`:
```sql
ALTER TABLE admin ADD COLUMN IF NOT EXISTS can_use_invoices boolean NOT NULL DEFAULT false;
```
Rollback (`.rollback.sql`): `ALTER TABLE admin DROP COLUMN IF EXISTS can_use_invoices;`. Safe to run twice. **Run it BEFORE deploying the code**: the admin list
now asks for the column and fails without it.

**Config and dependencies.** None.

**Money impact.** None. No invoice amount, number or payment record logic changes; only who may reach them.

**Tested.**
- Backend `invoiceAccess` (new, 8 passed on a local copy with `PAYROLL_TEST_DB=1 EVEREE_ONBOARDING_ENFORCED=false QUICKBOOKS_ONBOARDING_ENFORCED=false
  QUICKBOOKS_PAYMENTS_ENABLED=false`): route order; the toggle endpoint (ordinary admin refused, unknown id, a super admin target, success); the switch
  on, off, disabled admin, driver role and missing admin; the list, search, single read, edit and "payment received" limited to the admin's own invoices.
  `invoiceStore` (12) and `invoiceRules` (8, one route-order test updated) pass. Whole backend suite without the database: 431 tests, 333 passed, 0 failed
  (98 need the database). One earlier run showed 2 failures in the carrier statement route tests that did not appear in a rerun or alone; the cause was not found.
- Frontend: full suite 610 passed; lint and build clean. New tests for the route guard, the menu and the admin switch.

**Not tested.** In a browser with real data, and a real sign-in as an ordinary admin.

**Risks and follow-ups.**
- Existing invoices were all created by the super admin, so a selected admin starts with an empty list and sees only what they create.
- An invoice number is unique across the company, and "next number" counts every invoice, so a selected admin's suggested number can skip numbers.
- If an admin created invoices and is later switched off, those invoices stay (visible to the super admin) and come back if the switch is turned on again.
- Disabling an admin cuts their Invoices access at once. Their other sessions still follow the existing token rules.
