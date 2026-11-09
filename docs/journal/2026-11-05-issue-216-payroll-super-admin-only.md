# Payroll, pay runs and payments are for the super admin only; a Close button on an open run

- **Date:** 2026-11-05
- **Author:** Jayasoorya (with Claude Code)
- **Issue / PR:** #216 / see the pull request for this branch
- **Branch:** `feat/payroll-super-admin-only` (from `develop`)
- **Type and scope:** feat(payroll), backend and frontend
- **Files touched:** `Backend/routes/payrollRoutes.js`, `Frontend/src/App.jsx`, `Frontend/src/reuse/Nav.jsx`, `Frontend/src/routes/admin/SuperAdminRoute.jsx` (new), `Frontend/src/components/Admin/payRuns/RunDetail.jsx`, `Frontend/src/components/Admin/dashboard/PenaltyRows.jsx` (one link hidden). New and updated tests listed below. **Reserved files:** none edited. `PenaltyRows.jsx` sits in the Dashboard area that Jasil owns; the change is one line and is flagged for his review.

**What changed.**
1. **The server.** Every route under `/admin/payroll` (ledger, pay runs, payments, Everee connection, workers, batches and settings) now requires the `superadmin` role, checked in the router right after the sign-in check. An admin gets 403. The one exception is the Dashboard's penalty summary (`GET /drivers/:driverId/dashboard-summary`), which stays open to admins because the Dashboard calls it; the service still checks the admin's cities. New payroll routes must go below the guard line.
2. **The pages.** `/admin/payroll` and `/admin/pay-runs` sit behind a new `SuperAdminRoute`; any other admin is sent to the Dashboard. The menu lists Payroll and Pay runs only for the super admin.
3. **The Dashboard.** The "View entries and history" link under the Penalty & Others row goes to the Payroll page, so it is shown only to the super admin. Admins still see the amounts.
4. **Close.** An open pay run had only "Back to runs" at the very bottom, after every driver's statement. A Close button now sits at the top beside the status. It only leaves the run view; nothing is changed, and the draft stays in the Runs list.

**Database, config, dependencies:** none. **Money impact:** none; no calculation changed.

**Tested.** Backend `payrollRoutesAccess.test.js` (4 tests): exactly one route is above the guard (the Dashboard summary), the 30+ others are below it, and the guard answers 403 to an admin, a driver and a token with no role and passes a super admin. Removing the guard, or putting a route above it, makes it fail (checked). Frontend: `SuperAdminRoute.test.jsx` (3: super admin opens both pages, another admin lands on the Dashboard, the menu differs by role), `RunDetail.test.jsx` (Close is above the driver list and calls close), `PenaltyRows.test.jsx` (link hidden for an admin). The affected files pass alone; the frontend build passes. In the full frontend run, 12 tests across 8 files timed out under load on this machine (5 to 7 seconds each); all of them pass when their file is run alone, as before this change.

**Not tested.** Not opened in a browser, and no real admin-versus-super-admin request was made over HTTP (the Redis-backed sign-in check cannot load in a unit test, so the guard is tested on its own and the router order is read from the file). A person should sign in once as an ordinary admin and once as the super admin to confirm the menu, the redirect and a 403.

**Risks and follow-ups.** The Dashboard and Excel payment routes (`/admin/dashboard/paymentTable`, `payDriver` and similar) belong to Jasil's zone and are not changed here; if payment details there should also be hidden from admins, that is a separate decision with him. Drivers' own pay screens are unaffected. The per-city checks inside the payroll services stay as a second layer.
