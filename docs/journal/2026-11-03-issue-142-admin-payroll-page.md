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

## Review fix (Jasil's review on #155, 3 Nov 2026)

- **The form could not link a refund to its claim.** A pay run flags a claim that was deducted more than is now owed. Before, the page could only record a generic credit, which neither cleared that flag nor stopped a second refund. Two changes:
  - **"Refunds due" list.** Above the balances, the page lists the server's `refundsDue` (#153): the claim type, waybill and courier, and how much more was deducted than is now owed. **Record refund** pre-fills the form with a credit correction for that amount, naming the claim's courier, waybill and claim type, and a reason. Saving clears the item.
  - **Manual claim reference.** A credit correction can name a claim by courier, waybill and claim type (all three or none). A debit correction cannot name a claim: the server refuses it (#149), and the form does not show the fields.
  - Validation, city and driver checks and the claim exemption all stay on the server. The refund is linked by the claim's own identity, so it counts against that one claim and is paid once.
- **Tests:** `Payroll.test.jsx` now has 6 tests. New: a refund due is recorded through Record refund, and the body is a credit correction of 10.00 with courier, waybill and claim type; the item clears after saving. Claim fields appear only on a credit correction, and an empty reference sends nothing.
- **End to end by hand** (390 px), against the #153 backend on `nasa_local`, made-up data only:
  1. A claim was deducted at 40 on a finalized run, then lowered by the carrier to 30.
  2. The Payroll page listed "Damaged Item · TESTUI01 (GOFO): $10.00 deducted more than is now owed".
  3. Record refund filled correction, credit, 10.00, gofo, TESTUI01, Damaged Item. Saving cleared the item.
  4. The next pay run paid a 10.00 reimbursement with no claim deduction and no flags (net 110.00).
  5. The later week had no pay rows, so it does not show the refund is never paid twice. The database's one-reimbursement-per-entry rule and the backend tests cover that.
  6. The local payroll tables and made-up rows were removed afterwards.
