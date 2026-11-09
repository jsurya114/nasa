# Driver "My pay" screen (issue #145, part 2)

- **Date:** 2026-11-03
- **Author:** Jayasoorya (with Claude Code)
- **Issue / PR:** #145 (part of #138) / see the pull request for this branch. Uses the read-only API from #153; it can merge before or after it, but the screen shows data only once #153 and the pay run stack below it are live.
- **Branch:** `feat/driver-pay-statements` (from `develop`)
- **Type and scope:** feat(frontend)
- **Files touched:**
  - new:
    - `Frontend/src/components/Drivers/Pay.jsx` (page);
    - `Frontend/src/components/Drivers/pay/StatementList.jsx`, `StatementDetail.jsx`, `BalanceSummary.jsx` and `payLabels.js`;
    - `Frontend/src/hooks/usePayStatements.js`;
    - `Frontend/src/utils/money.js`;
    - test `Frontend/src/components/Drivers/Pay.test.jsx`.
  - changed:
    - `Frontend/src/App.jsx` adds the route `/driver/pay`;
    - `Frontend/src/reuse/driver/Nav.jsx` adds the "Pay" item, which sits under "More", so the first four tabs are unchanged;
    - `Frontend/src/hooks/translation.js` adds 51 keys in both EN and ES.
  - this journal entry.

  No reserved files are edited. The mobile shell, `axiosInstance` and the driver slices (Jasil's mobile zone) are only used, not changed. The push-notification screen list is unchanged.

**What and why.** Drivers can now see their pay under More → Pay (`/driver/pay`):
- **Totals:** what they still owe and what is owed to them.
- **Open items:** every open claim, advance or expense, with the original amount, what was recovered, the repayment plan and the paydays that took it. An exempt claim (DFW / Dallas GOFO and Tracking interruption) shows the carrier's charge and "Exempt: not charged to you".
- **Statement list:** each approved statement with its period, city, daily or weekly, net pay and one state. The states are Pending, Approved, Sent for payment, Paid, Payment failed, Being checked and Cancelled, so they are never mixed up.
- **One statement:** earnings, insurance, reimbursements, claim deductions, recoveries and net. Below that come earnings by day and route, each claim with the carrier's charge next to what was deducted, each recovered advance or expense with its reason and original amount, and each reimbursement. A cancelled (voided) statement says nothing on it was paid or deducted.

Every number comes from the server's frozen statement. The screen adds nothing up again: no second payroll formula. Requests carry no driver ID; the server takes it from the token. The data lives only in the page's state, never in Redux or storage, so nothing is left behind for the next person on a shared phone.

Text the carrier or an admin typed (claim type, ledger reason) is shown as entered, in either language.

- **Database:** None.
- **Config and dependencies:** None. `Intl.NumberFormat` formats money: `en-US`, or `es-US` in Spanish.
- **Money impact:** None. Display only.

**Tested.**
- `Pay.test.jsx` (6 tests):
  - totals and statements appear, and the only pay requests are `/driver/payroll/statements` and `/driver/payroll/balances`, with no driver ID;
  - an exempt claim and an instalment's payday are shown;
  - a statement opens with the carrier charge, the deduction, the advance's reason and the totals, and goes back;
  - the screen works in Spanish;
  - the empty state;
  - the error state with a working retry.
- Full frontend suite: 116 pass. Lint is clean on every changed file. `vite build` passes.
- By hand at phone width (390 × 844), in EN and ES. The test backend was branch #153 on port 5003, on `nasa_local` with made-up data only: one test city, route and driver, and one finalized run. The numbers checked: 292.50 earnings − 5.62 insurance + 12.25 reimbursement − 40.00 claim − 50.00 instalment = 209.13 net, with 150.00 still owed.
- Fixes made after that check:
  - a date was wrapping mid-way;
  - the row's label was hiding the state and net from screen readers; it now reads "View statement 2026-11-01 – 2026-11-07 Test Pay UI · Daily Approved Net pay $209.13".

**Not tested.** Inside the native mobile shell (Jasil's area), real production data, a driver with many statements (the server returns 100 at most), and payout states other than Approved by hand (covered only in tests).

**Risks and follow-ups.** The admin view of a driver's statements and the admin ledger screen come next. Opening a statement does not scroll to the top on a long page.
