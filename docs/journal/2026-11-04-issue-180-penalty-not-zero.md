# A penalty entered on the Payroll page showed $0 on the dashboard (issue #180, follow-up)

- **Date:** 2026-11-04
- **Author:** Jayasoorya (with Claude Code)
- **Issue / PR:** #180 / see the pull request for this branch
- **Branch:** `fix/dashboard-penalty-not-zero` (from `develop`, after #181)
- **Type and scope:** fix(payroll), backend
- **Files touched:** `Backend/services/payroll/statements/periodSummary.js`, `Backend/services/payroll/payRuns/payCalculator.js` (one flag), test `Backend/tests/periodSummary.test.js`; this entry. No reserved files.

**What was reported.** An admin added a penalty for a driver on the Payroll page; filtering that driver on the dashboard still showed Penalty & Others as $0.

**What I found, by checking the real local data** (a driver with $60 of penalties, entered 3 and 4 Nov with "all on the next payday", pay rows from 28 Sep to 4 Oct, no recovery limit): the server said $60.00 owed and $0.00 deducted. Two separate causes:
1. **No recovery limit is set** (the default). The pay calculator then takes nothing automatically, by design. With dates the page already said so; with no dates it said nothing (see 2).
2. **A bug in the no-date estimate.** Its period was the span of the driver's pay rows (28 Sep to 4 Oct), so a penalty dated 3 Nov looked "dated after the period, taken later" and was skipped **silently**, even with a limit set. A real pay run for the last days ends today, so a record dated up to today is due in it; the estimate did not follow that.

**The fix.**
- The no-date estimate's period now runs from the driver's first unpaid work day to **today** (or to their last work day if that is later). A record dated up to today is then due, as in the real draft for the last days.
- A record that is really not due yet (dated in the future, or "not before" a later payday) now gives the reason `not_yet_due` instead of a silent zero. The calculator adds only this flag; no amount changes.
- With the data above and a 100% recovery limit, the figure is $60.00 (before: $0.00 even with the limit). Without a limit it is $0.00 and the reason "no recovery limit is set" now shows with no dates too.

**What still needs the owner.** The recovery limit. Until one is set on the Pay runs page (for example 100% of the driver's pay, never below zero), nothing is deducted automatically, and the dashboard says so. That is a policy setting, not changed here.

- **Database:** None. **Config and dependencies:** None.
- **Money impact:** the dashboard's no-date figure now includes records dated after the driver's last work day (up to today), matching the real draft. The real pay run's amounts are unchanged.

**Tested.** `periodSummary.test.js` (database, dates relative to today): a penalty entered after the week the pay is for is taken in the no-date estimate and equals the real draft that ends today ($60 deducted, $40 net); a future-dated record is not taken and says `not_yet_due`; with no limit the reason shows without dates. The first and third fail on the previous code (checked). Whole backend suite with both database flags: 0 failures (33 skipped by the other switch). Also checked against the local database in a rolled-back transaction: no limit gives $0.00 with the reason; a 100% limit gives $60.00.

**Not tested.** By hand in the browser.
