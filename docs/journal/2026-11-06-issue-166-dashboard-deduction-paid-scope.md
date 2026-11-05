# Dashboard: an unpaid run's figures only stand in for the rows the table shows (issue #166, review of #219)

- **Date:** 2026-11-06
- **Author:** Jayasoorya (with Claude Code)
- **Issue / PR:** #166 / #219, answering Jasil's review of 2026-11-05 (P1)
- **Branch:** `fix/dashboard-penalty-with-runs`
- **Type and scope:** fix(payroll), backend and the Dashboard's summary request
- **Files touched:** `Backend/services/payroll/statements/periodSummary.js`, `Backend/controllers/payroll/statementController.js`, `Frontend/src/components/Admin/dashboard/usePenaltySummary.js` (the Dashboard area Jasil owns; he asked for this in his review), tests `Backend/tests/periodSummary.test.js` and new `Frontend/src/components/Admin/Dashboard.penaltyScope.test.jsx`. No reserved files.

**The finding.** With no dates, #219 shows an unpaid run's own deduction and net when all the driver's pay is on runs that are not yet paid. The Dashboard can also be filtered to Paid, and the summary request did not say so. A table of paid history then had its net replaced by an unrelated unpaid run's net, labelled as an approved run: with a $200 paid statement and a separate $100 unpaid run netting $60, Paid history showed $60 instead of $200.

**What changed.**
- The summary request now carries the Payment status filter (`paymentStatus` = Paid or Pending; All sends nothing). The server accepts `paid`, `pending` or nothing, and refuses any other value (400).
- The unpaid-run fallback is used only when **every pay row the table would show is held by an open run** (`covers`). So: Pending (the unpaid rows, all on the run) shows the run's figures; Paid (history) and All (paid and unpaid rows together) do not, and keep what they showed before #219. The rule is about the rows, not the label, so a Pending table with a row that is on no run also does not use it.
- The status is part of the Dashboard hook's scope key, so a change of status asks again and an earlier answer is never reused for another status.
- The mixed policy is unchanged: when unpaid pay is not on a run, the estimate is shown alone, as before.

**Database / config / money:** None. Display only; nothing is calculated or paid differently.

**Tested.**
- Backend (`periodSummary.test.js`, database, rolled back, 19 pass; with `statementStore` and `balanceAllocation`, 35 pass): new case for Jasil's scenario (a paid $200 run and a separate approved unpaid run, $100 pay, $40 taken, net $60): Paid keeps no run figures, Pending shows $40 and net $60, All shows none, and a bad status is refused. It fails with the row check removed (checked).
- Frontend (`Dashboard.penaltyScope.test.jsx`, real Dashboard): the request carries Paid / Pending / nothing; Paid keeps the table's own net, Pending shows the approved run's $60, switching back to Paid asks again and shows no stale run net. It fails with the status removed from the request (checked). Dashboard, dashboard-folder and Payroll tests (54) pass; the build passes.

**Not tested.** In a browser.

**Risks and follow-ups.** A Pending table that also lists rows not yet closed (on no run) does not use the run's figures; it keeps the old "nothing can be taken" result, which is the safe side. The route and data-type filters of the table are not part of the rule, only the payment status, as in the review.
