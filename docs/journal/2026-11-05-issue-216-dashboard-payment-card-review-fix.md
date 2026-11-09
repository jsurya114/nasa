# Dashboard: no Driver payments card for ordinary admins (issue #216, review of #217)

- **Date:** 2026-11-05
- **Author:** Jayasoorya (with Claude Code)
- **Issue / PR:** #216 / #217, answering Jasil's review of 2026-11-05 (P1)
- **Branch:** `feat/payroll-super-admin-only`
- **Type and scope:** fix(frontend)
- **Files touched:** `Frontend/src/components/Admin/Dashboard.jsx` (one line, in the Dashboard area Jasil owns; he asked for this change in his review), new test `Frontend/src/components/Admin/Dashboard.paymentRoles.test.jsx`. No reserved files.

**What and why.** The payroll guard made the payment-runs list super admin only, but the Dashboard still mounted the "Driver payments" card for everyone. An ordinary admin therefore saw a card showing FORBIDDEN, a Try again button that could not succeed, and a "Prepare a pay run" link to a page they cannot open. The card is now rendered only when `isSuperAdmin`, so an ordinary admin's Dashboard makes no request for it, on mount or on focus. The server guard is unchanged, and the penalty summary stays open to admins as before. I also searched the frontend for other callers of payroll URLs outside the Payroll and Pay runs pages; the penalty summary was the only other one.

**Database / config / money:** None.

**Tested.** New `Dashboard.paymentRoles.test.jsx` (2) on the real Dashboard: an ordinary admin makes no payment list request (including after a window focus), and sees no "Driver payments", no FORBIDDEN and no pay run link; the super admin keeps the card, the request and the link. The admin test fails with the gate removed (checked). The six Dashboard test files (34 tests) pass; the production build passes.

**Not tested.** In a browser as a real admin and super admin.
