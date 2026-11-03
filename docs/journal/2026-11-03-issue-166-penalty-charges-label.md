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
- A separate "Penalty charges" tile shows the open total of hand-entered penalties, next to "You still owe". The two are separate: "You still owe" leaves penalties out, so nothing is counted twice (both are worked out in the browser from the amounts the API sends). It appears only when a penalty is open, and exempt penalties count zero.

On the admin Payroll page the two cards read "Driver owes NASA" and "NASA owes driver — reimbursements and adjustments" (Jasil's wording, 3 Nov 2026: an admin is reading a driver's account). The driver's own page keeps "You still owe" / "Owed to you".

Wording and one displayed sum only. The stored type is still `manual_claim`.

Not in this part (see #166): edit, mark complete, and the dashboard row, which needs Jasil's reply on the reserved dashboard files.

- **Database:** None.
- **Config and dependencies:** None.
- **Money impact:** None. No amount is calculated or changed; the tile adds up amounts the API already sends.

**Tested.** `Payroll.test.jsx` (7) and `Pay.test.jsx` (6) pass, including a new test for the label, the list title and the tile. Lint is clean on the changed files; `vite build` passes.

**Not tested.** By hand in a browser; against real data.
