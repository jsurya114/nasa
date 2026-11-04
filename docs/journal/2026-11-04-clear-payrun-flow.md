# Pay runs and advances: explain what the admin is approving (PR #195)

- **Date:** 2026-11-04
- **Author:** Jasil (with Codex). This entry was added at review time by Jayasoorya (with Claude Code) from the pull request description and a test run, because the required journal file was missing (Engineering Standard section 8).
- **Issue / PR:** none / #195
- **Branch:** `feat/payroll-clear-payrun-flow` (from `develop`)
- **Type and scope:** feat/fix(payroll), mostly frontend, one additive backend field
- **Files touched:** `Frontend/src/components/Admin/PayRuns.jsx` and `.test.jsx`, `payRuns/NewRunForm.jsx`, `payRuns/RecoveryLimitPanel.jsx`, `payRuns/RunDetail.jsx` and `.test.jsx`, `payroll/AdminBalances.test.jsx`, `payroll/EditEntryPanel.jsx`, `payroll/LedgerEntryForm.jsx`; `Backend/services/admin/dbQueries.js` (one extra column). No reserved files other than the payroll files above.

**What and why.** Admins saw zero recoveries next to an outstanding debt without knowing why, and could not confirm that an existing advance had been handed over. The draft form also accepted an invalid date span until the server refused it. The change explains the existing rules and makes the existing correction action reachable:
- Pay-run review separates driver pay, advances and other deductions, and the balance still owed to NASA. The full breakdown is expandable; drivers can be searched and filtered by "needs attention".
- A held deduction is explained and links to that driver's Payroll records.
- Cash-handover confirmation is available in Edit, through the **existing audited correction endpoint** (it sends only the changed field and the audit reason; the original stays in history and its amount and instalment arrangement are kept).
- The 31-day limit is shown before submitting and enforced in the form; GOFO cities default to weekly data; an empty draft is explained and cannot be approved.
- Setup controls are collapsible; the page says a saved draft is not recalculated after records or settings change.
- Assigned-city reads also return `city_type` (additive, read-only; the city and access filters are unchanged).

- **Database:** None. **Config and dependencies:** None.
- **Money impact:** none to any stored amount or calculation (no pay-calculation, rate, import, schema or payout change). Author's before and after for the same synthetic inputs ($100 earnings, $10 insurance, $100 advance in $50 instalments): eligible advance, $50 deducted, $40 net, $50 remaining; unconfirmed cash, $0 deducted, $90 net, $100 remaining. Four synthetic before/after calculator comparisons were identical.

**Tested (by the author, as reported in the pull request).** Frontend 201 tests; backend with both database switches on a disposable clone, 291 passed and 33 skipped; browser checks on desktop and a 390px phone with mocked synthetic APIs.
**Tested (by the reviewer, on this head).** Frontend suite: 21 files, 201 tests pass; lint of the touched files is clean. The backend change is one selected column.

**Not tested.** Against real data; the cash confirmation end to end against a real server by the reviewer.
