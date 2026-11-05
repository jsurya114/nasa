# Dashboard: an unpaid run's figures only stand in for exactly the rows the table shows (issue #166, second review of #219)

- **Date:** 2026-11-06
- **Author:** Jayasoorya (with Claude Code)
- **Issue / PR:** #166 / #219, answering Jasil's second review of 2026-11-05 (P1)
- **Branch:** `fix/dashboard-penalty-with-runs`
- **Type and scope:** fix(payroll), backend and the Dashboard's summary request
- **Files touched:** `Backend/services/payroll/statements/periodSummary.js`, `Backend/controllers/payroll/statementController.js`, `Frontend/src/components/Admin/dashboard/usePenaltySummary.js` (the Dashboard area Jasil owns; he asked for this in his review), tests `Backend/tests/periodSummary.test.js` and `Frontend/src/components/Admin/Dashboard.penaltyScope.test.jsx`. No reserved files.

**The finding.** The previous fix checked that every row the table shows is held by the open run. It ignored the Route filter: with one driver's Route A ($100) and Route B ($200) held by one unpaid run (a $40 penalty, net $260), a table filtered to Pending and Route A shows $100, but its net was replaced by the whole run's $260 and labelled an approved pay run.

**What changed.**
- The check is now **equality**: the run's figures stand in only when the rows the table shows are **exactly** the rows the open runs hold. Not one row more (Paid, one route, or the daily or weekly tab) and not one row less (a single route of a run that holds two). The frozen deduction is for the whole run; it is never spread over routes and no payroll rule changed.
- The summary request now also carries the applied **Route** (a route name) and the **View tab** (daily or weekly; "all" sends nothing). The server validates them (400 for a tab other than all, daily or weekly, or an empty or over-long route name) and matches them as the table does: route by `routes.name`, the tab by the same weekly-or-daily rule on `start_seq` and `end_seq` that the table query uses.
- The route and the tab are part of the hook's scope key, so changing either asks again, and an answer that arrives late for another scope is dropped (the request is also aborted). The tab was not named in the review; it is the same kind of gap (the table can show only the daily or only the weekly rows), so it is closed here too.

**Also from the review.** One of the existing backend tests reused a seeded driver that has unrelated historical pay rows, so a check that the run holds all the driver's rows is false on such a database. That assertion is removed from that test; the no-dates run fallback is covered with fresh synthetic drivers (the approved-run case, Paid / Pending / All, and the new two-route case).

**Database / config / money:** None. Display only; nothing is calculated, deducted or paid differently.

**Tested.**
- Backend (`periodSummary.test.js`, database, rolled back, 20 pass; with `statementStore` and `balanceAllocation`, 36 pass): new two-route case (one driver, Route A $100 and Route B $200, one run, $40 taken, net $260): both routes together show the run's $40 and $260; each route alone keeps its own net (no run figures); the weekly tab shows the run, the daily tab does not; an unknown tab and an empty route are refused. It fails with only the old "every shown row is held" check (checked).
- Frontend (`Dashboard.penaltyScope.test.jsx`, real Dashboard, 2 tests): the route is sent; while Route A's answer is held back, switching to Route B shows Route B's table, and when Route A's late answer (the run's $260) arrives it is not shown; back to All sends no route. It fails with the route removed from the request (checked). Dashboard, dashboard-folder, Payroll and payroll-folder tests (71) pass; the build passes.

**Not tested.** In a browser, and the daily and weekly tab on the frontend (it is tested on the server); the controller's own validation (the controller cannot be loaded in a test without Redis, as in the access test).

**Risks and follow-ups.** The route and tab rules are exact; a table that shows a subset of a run's rows keeps its own net and its own deduction line as before, and the run's figures are not shown for it. If the owner wants the run's figures shown separately beside such a table, that is a display design change, as Jasil's review offered, and is not done here.
