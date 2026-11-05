# Carrier claims from the Excel count as penalties, not "Driver owes NASA" (issue #166)

- **Date:** 2026-11-05
- **Author:** Jayasoorya (with Claude Code)
- **Issue / PR:** #166 / the pull request for `fix/claims-in-penalty-charges`
- **Branch:** `fix/claims-in-penalty-charges` (from `develop`)
- **Type and scope:** fix(payroll), backend and a tooltip in the frontend
- **Files touched:** `Backend/services/payroll/statements/statementStore.js` (`allocateOwed`), `periodSummary.js` (comment), `Frontend/src/components/Admin/payroll/AdminBalances.jsx` (two tooltips), tests `balanceAllocation.test.js`, `periodSummary.test.js`. No reserved files.

**What and why.** After a weekly Excel was uploaded and pay calculated, the carrier claims read from the Excel (for example a tracking interruption or a fake proof of delivery) showed under "Driver owes NASA", and "Penalty charges" stayed at $0.00. The split from #166 had counted only hand-entered penalties as penalties. The owner asked that the Excel claims show as penalties too.

Now `allocateOwed` marks carrier claims as penalties. "Penalty charges" is the hand-entered penalties plus the Excel claims. "Driver owes NASA" is everything else (advances, expenses, corrections). The Payroll cards, the driver's own page and the Dashboard row ("Penalties" and "Others") read the same two numbers, so all three follow. The tooltips on the two cards now say so.

**Database:** None. **Config and dependencies:** None.

**Money impact:** None. Nothing that is deducted, owed or paid changes. `owedByDriver` is the same figure as before; only which of the two cards a claim's amount is listed under moves. Repayments made outside payroll are still spread oldest first, ledger debts then claims, and the two parts still add up to the total.

**Tested.** `balanceAllocation.test.js` (pure, new cases: a claim alone is a penalty; a claim after a hand-entered penalty; a repayment clears an older advance first, then the claim; an advance stays under "other"). The database tests `statementStore` and `periodSummary` (rolled back) pass with `PAYROLL_TEST_DB=1`, with the Dashboard expectation changed to 365.00 penalties and 0.00 others. Frontend `AdminBalances`, `Payroll` and `Pay` tests pass (41).

**Not tested.** In a browser, and with a real uploaded Excel. The screenshot that raised it was from a local upload.

**Risks and follow-ups.** The Dashboard row's "Others" now shows less (claims moved into "Penalties"); Jasil owns that area and should know, but no code there changed. The record list on the left still labels each Excel row "Carrier claim", which is unchanged.
