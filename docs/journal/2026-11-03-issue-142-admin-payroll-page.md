# Admin Payroll page: a driver's statements and balances, and manual ledger entries (issues #142 and #145)

- **Date:** 2026-11-03
- **Author:** Jayasoorya (with Claude Code)
- **Issue / PR:** #142 (admin screen), #145 (admin view) / see the pull request for this branch. It is stacked on #154 (driver screen) and reuses its components. It reads #149 (`/admin/payroll/ledger`) and #153 (the statement API).
- **Branch:** `feat/admin-payroll-page` (from `feat/driver-pay-statements`)
- **Type and scope:** feat(frontend)
- **Files touched:**
  - new:
    - `Frontend/src/components/Admin/Payroll.jsx`
    - `Frontend/src/components/Admin/payroll/LedgerEntryForm.jsx`
    - `Frontend/src/utils/requestId.js`
    - test `Frontend/src/components/Admin/Payroll.test.jsx`
  - changed:
    - `Frontend/src/App.jsx`: route `/admin/payroll`
    - `Frontend/src/reuse/Nav.jsx`: "Payroll" item, under More
    - `Frontend/src/components/Drivers/pay/StatementDetail.jsx`: takes an optional `load` function, so the admin page can read through the admin route
  - this journal entry.

  No reserved files are edited. The page *calls* `GET /admin/dashboard/drivers-by-city` (Jasil's dashboard controller) to list a city's drivers, without changing it.

**What and why.** Admins and super admins get a Payroll page: choose a city, then a driver.

Left side:
- what the driver owes and is owed;
- each open claim, advance and expense, with what was recovered and on which payday;
- their statements, with drafts shown as Pending; a statement opens through the admin route;
- a warning when debits have no repayment arrangement, because those are not recovered until one is recorded.

Right side: **Record an entry** (#142), with these fields:
- type: advance, expense, claim entered by hand, advance repaid outside payroll, reimbursement, or correction with its direction;
- amount, date, reason;
- an optional "not before" payday;
- for an advance, whether it was already paid out;
- for anything the driver owes, the repayment arrangement: none yet (needs review), all on the next payday, or fixed instalments with the amount per payday;
- for a hand-entered claim, its type and waybill.

The server checks everything again (#149). Each form keeps one request ID until the entry is saved, so a retried click is never saved twice. The ID is made with `crypto.randomUUID`, or `crypto.getRandomValues` on pages that are not https. The server's field errors appear under each field and are linked with `aria-describedby`, so the field keeps its short name.

City access is the server's job: every request carries the city, and the API refuses a city the admin is not assigned to (tested in #153 and #149). The city list comes from `/admin/get-admin-cities`, so a city admin only sees their own.

Admin pages are English only, like the rest of the admin area. The reused statement components follow the language setting.

- **Database:** None.
- **Config and dependencies:** None.
- **Money impact:** None from this code. It records ledger entries through the existing API; it calculates nothing.

**Tested.**
- `Payroll.test.jsx`, 4 tests:
  - balances and statements load with the chosen `cityId`, the needs-review warning shows, and a draft opens through `/admin/payroll/statements/:id`;
  - an advance with instalments sends the right body, with a version 4 request ID, then reloads;
  - a server field error is shown, and the retry reuses the same request ID;
  - a reimbursement offers no repayment arrangement and no "paid out" box.
- Full frontend suite: 120 pass. Lint is clean on the changed files. `vite build` passes.
- By hand at phone width (390 × 844), as a made-up super admin, against branch #153's backend on `nasa_local`, with made-up data only:
  - chose the test city and driver: balances showed $150.00 owed, the exempt claim, and the advance with its payday;
  - recorded a $30 expense with no arrangement: owed became $180.00 and the needs-review warning appeared;
  - submitted an empty form: "amount is blank or not a number" and "give a reason" showed under their fields, with `aria-invalid`.
- Fixed during the check:
  - errors used to sit inside the label, which changed the field's name;
  - a long option was cut off on a phone.

**Not tested.**
- A city admin by hand (the server's city checks are covered by the backend tests).
- Voiding an entry from the screen: it is not on the page yet.
- Real production data.

**Risks and follow-ups.**
- Voiding an entry from the page.
- The pay run screen (draft, finalize, discard, void, recovery limit) for #143.
- The driver list comes from a dashboard endpoint in Jasil's zone. If it changes shape, this page needs updating.
