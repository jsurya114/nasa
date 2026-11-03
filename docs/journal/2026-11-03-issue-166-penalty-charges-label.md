# Show hand-entered claims as "Penalty charges" (issue #166, part 1)

- **Date:** 2026-11-03
- **Author:** Jayasoorya (with Claude Code)
- **Issue / PR:** #166 / see the pull request for this branch
- **Branch:** `feat/penalty-label-ledger` (from `develop`)
- **Type and scope:** feat(frontend)
- **Files touched:** `Frontend/src/components/Drivers/pay/BalanceSummary.jsx`, `Frontend/src/components/Admin/Payroll.jsx`, `Frontend/src/components/Admin/payroll/LedgerEntryForm.jsx`, `Frontend/src/hooks/translation.js`, test `Frontend/src/components/Admin/Payroll.test.jsx`, this entry. No reserved files.

**What and why.** The owner asked that a claim entered by hand reads as a penalty.
- The record form's type is now "Penalty (entered by hand)".
- The open-balances list titles such an entry "Penalty charges: <reason>" (English and Spanish).
- A separate "Penalty charges" tile shows the open total of hand-entered penalties, next to "You still owe". The two are separate: "You still owe" leaves penalties out, so nothing is counted twice (the split comes from the server, see the review fix below). It appears only when a penalty is open, and exempt penalties count zero.

On the admin Payroll page the two cards read "Driver owes NASA" and "NASA owes driver — reimbursements and adjustments" (Jasil's wording, 3 Nov 2026: an admin is reading a driver's account). The driver's own page keeps "You still owe" / "Owed to you".

Wording and one displayed sum only. The stored type is still `manual_claim`.

Not in this part (see #166): edit, mark complete, and the dashboard row, which needs Jasil's reply on the reserved dashboard files.

- **Database:** None.
- **Config and dependencies:** None.
- **Money impact:** None. No amount is calculated or changed; the tile adds up amounts the API already sends.

**Tested.** `Payroll.test.jsx` (7) and `Pay.test.jsx` (6) pass, including a new test for the label, the list title and the tile. Lint is clean on the changed files; `vite build` passes.

**Not tested.** By hand in a browser; against real data.

## Review fix (Jasil's review on #167, 3 Nov 2026)

- **Problem.** The split was worked out in the browser by subtracting the per-entry penalty balance from the total, which already includes repayments made outside payroll. A $40 penalty with a $20 outside repayment owes $20, but the cards showed $0 plus $40.
- **Now the server allocates.** `statementStore.js` spreads the repayments made outside payroll over what is owed, oldest first (the driver's ledger debts, then carrier claims, the same order pay runs use), and returns `totals.owedPenalties` and `totals.owedOther`. They always add up to `totals.owedByDriver`, which is unchanged. A repayment larger than the debt never goes negative.
- **The cards** read those two numbers (no arithmetic in the browser), and a "Total owed" line under them shows the sum when a penalty is open. The admin and driver pages share the component, so both are fixed.
- **Tests.** `balanceAllocation.test.js` (5, pure): partial repayment, full and over-repayment, oldest-first order, carrier claims after ledger debts, credits ignored; every case checks that the parts add up to the total. `statementStore.test.js` has a database case with a real outside repayment (the parts add up for the driver and the admin view). `Payroll.test.jsx` and `Pay.test.jsx` each have the $40 / $20 case and a fully repaid balance.
- **Database / money.** None. Read-only; `owedByDriver` is the same figure as before.
