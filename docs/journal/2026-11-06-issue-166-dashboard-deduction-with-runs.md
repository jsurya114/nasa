# Dashboard: the deduction stays visible once the pay is on a run (issue #166)

- **Date:** 2026-11-06
- **Author:** Jayasoorya (with Claude Code)
- **Issue / PR:** #166 / the pull request for `fix/dashboard-penalty-with-runs`
- **Branch:** `fix/dashboard-penalty-with-runs` (from `develop`)
- **Type and scope:** fix(payroll), backend (the Dashboard summary service)
- **Files touched:** `Backend/services/payroll/statements/periodSummary.js`, `Backend/tests/periodSummary.test.js`. No reserved files, and no Dashboard frontend file.

**What and why.** An admin chose a city and a driver on the Dashboard, left the dates empty and pressed Filter Data. The driver's pay had already been put on a pay run that was approved but not yet paid. The "Penalty & Others" row and the Summary line then read $0.00, with "no closed, unpaid pay rows in these dates, so nothing can be taken", although the run had taken the driver's claims and an instalment. With no dates the summary looked only at pay not yet on a run, and ignored runs already made. Once all of a driver's pay is on a run there is no unpaid pay left, so it reported nothing.

Now, with no dates, if nothing is left to estimate and the driver has a draft or approved run whose statement is not yet paid, the figures are that run's own: claims, instalments, net. The source is `approved` (every such statement is on an approved run) or `draft`. The "nothing can be taken" reason is gone in that case. Everything else is as before:
- With dates, nothing changed.
- With unpaid pay not on a run, the estimate is shown alone, as before (summing an older unpaid run onto it would change what "this payday" means).
- A paid statement (`paid_at` set) or one of a discarded or voided run is history: nothing is shown, as before.
- "Still owed in all" is unchanged. A record added after a run shows there at once (the Dashboard asks again on Filter Data and when the tab is shown); it comes off a later payday, so this payday's figure does not move.

**Database:** None (a read-only query on `pay_statements` and `pay_runs`). **Config and dependencies:** None.

**Money impact:** None. Nothing is calculated, deducted or paid differently; the Dashboard now shows the run's own frozen figures instead of $0.00. Display only.

**Tested** (`periodSummary.test.js`, database, rolled back, `PAYROLL_TEST_DB=1`, 18 pass):
- New: with no dates, pay already on an approved run shows that run's deduction and net with no reasons; a record added later raises what is owed but not this payday's figure; once the statement is paid it is history.
- Two existing cases changed because they asserted the old "runs are ignored" result: after two unpaid drafts hold all the pay, the Dashboard shows what they took (75.00, net 155.00), and (in the scenario that checks nothing is estimated twice) 100.00 and net 100.00.
- Checked that the new case and these two fail when the change is switched off.
- On the local database, for a driver whose pay is on a finalized unpaid run: before 0.00 with the reason, after 212.00 (162.00 claims and a 50.00 instalment).

**Not tested.** In a browser.

**Risks and follow-ups.** When a driver has both unpaid pay not on a run and an older unpaid run, the Dashboard still shows the estimate for the unpaid pay only (as before). That is the Dashboard's "next payday" meaning, and it is Jasil's call whether to show both. The Summary panel shows this payday's deduction only; "still owed" is in the row under the table.
