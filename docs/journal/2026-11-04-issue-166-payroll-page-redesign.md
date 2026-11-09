# Payroll page: advance and penalty only, a repayment rule, one list, searchable driver, info icons, two cards (issue #166)

- **Date:** 2026-11-04
- **Author:** Jayasoorya (with Claude Code)
- **Issue / PR:** #166 / see the pull request for this branch (one PR, as the owner asked)
- **Branch:** `feat/payroll-page-redesign` (from `develop`)
- **Type and scope:** feat(frontend) with a small backend rule
- **Files touched:**
  - frontend, new: `reuse/InfoTip.jsx`, `hooks/useDebouncedValue.js`, `Admin/payroll/SearchSelect.jsx`, `AdminBalances.jsx`, `moneyInput.js`; changed: `Admin/Payroll.jsx`, `payroll/LedgerEntryForm.jsx`, `payroll/formParts.jsx`; removed: `payroll/EntryManager.jsx` (its panels are reused); tests `Payroll.test.jsx` and `payroll/AdminBalances.test.jsx` (the old `EntryManager.test.jsx`, renamed and adapted);
  - backend, new: `services/payroll/ledger/driverPayable.js`, test `tests/ledgerArrangementRule.test.js`; changed: `ledgerStore.js` (one rule), `statementStore.js` (one field), and the fixtures of `ledgerStore`, `ledgerEdits`, `periodSummary` and `statementStore` tests;
  - this entry. No reserved files.

**What the owner asked for, and what was done.**
1. **Type list: Advance and Penalty only.** The page offers just these two. A refund chosen from "Refunds due" still opens the form with its own fixed type; it is not something to pick by hand. The server still accepts the other types.
2. **More than the driver's payment must be repaid on the next payday or by instalments.** "The driver's payment" is their closed, unpaid pay in the city, less insurance, that no pay statement has taken yet (new `payable` on the admin balances, from `driverPayable`). When the amount is more than that, the form drops "None yet", asks for all-on-next-payday or fixed instalments, and says why. The **server enforces it too**: an advance or penalty above the payment with no arrangement is refused (400, message on the arrangement field). An amount up to the payment, an exempt claim, and the other types are not affected. *Assumption to confirm: "driver payment" means this current unpaid pay.*
3. **No minus amounts.** A minus sign, a letter or a third decimal cannot be typed; zero is refused before anything is sent (the server already refused negative and zero amounts). An instalment must be more than zero and less than the whole amount.
4. **The added record shows on the left.** The left side now has two cards and one **Records** list. A record saved on the right appears there straight away.
5. **Edit, Mark complete and History are inside the list**, under each record, instead of a separate "Manage entries" section.
6. **Search inside the driver dropdown, debounced.** The driver picker is a combobox: typing filters the names after a 250 ms pause (not on every key), case ignored; arrow keys, Enter and Escape work.
7. **Info (i) icons** on City, Driver, Type, Amount, Date, Reason, Not before payday, Repayment arrangement, Instalment, the paid-out box, Claim type, Waybill, the cards and Records. They open on hover, focus or tap and close on Escape.
8. **Reimbursements card removed.** Two cards remain: **Driver owes NASA** and **Penalty charges**, both always shown, with the total below when there is a penalty. Reimbursements and other records still appear in the list.

**Money impact:** none to existing amounts. New entries above the driver's payment now need an arrangement.

- **Database:** None. **Config and dependencies:** None.

**Tested.** Backend (`ledgerArrangementRule.test.js`, database, rolled back): the payment is closed, unpaid pay less insurance (paid and open rows do not count; a driver sees no such field); equal to the payment needs no arrangement, one cent more is refused with a message on the arrangement field, for a penalty and an advance; with all-on-next-payday or instalments any amount is accepted; a driver with no pay needs one for any amount; an exempt claim, an expense and the credit types are not affected. Whole backend suite 0 failures (36 skipped). Frontend (`Payroll.test.jsx` 14, `AdminBalances.test.jsx` 13): the two types; no minus sign and zero refused; the repayment rule on the form (note shown, "None yet" gone, refused without one, accepted with one, instalment limits); a saved record listed on the left with its three buttons; the debounced driver search (3 options stay until the pause, then 1; no match message; case ignored; Enter picks and loads); every info icon, and Escape; two cards only; plus the earlier cases (refund, field errors and retry, link from the dashboard). Every frontend test file passes; lint is clean on the changed files; build passes.

**Not tested.** By hand in a browser at phone width; against real drivers.

**Follow-ups.** The rule uses the driver's current unpaid pay; if the owner means another figure (for example the weekly or last payday), only `driverPayable` changes.
