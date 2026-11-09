# Dashboard: the rows "shown" are chosen exactly as the real table chooses them (issue #166, third review of #219)

- **Date:** 2026-11-06
- **Author:** Jayasoorya (with Claude Code)
- **Issue / PR:** #166 / #219, answering Jasil's third review of 2026-11-05 (P1)
- **Branch:** `fix/dashboard-penalty-with-runs`
- **Type and scope:** fix(payroll), backend
- **Files touched:** `Backend/services/payroll/statements/periodSummary.js`, test `Backend/tests/periodSummary.test.js`. No reserved files; `dashboardQueries.js` was only read, to copy its predicates.

**The finding.** The coverage check compares the rows the table shows with the rows the open runs hold, but the "shown" query differed from the real Dashboard table (`AdminDashboardQueries.getPaymentDashboardPaginated`): it took the city from the driver's current city and ignored the city's type. The real table takes the city from the route (`routes.job` joined to `city`, so historical rows count), and whenever a city is chosen it applies the city's type on every tab: a DAILY city shows only rows with both sequence numbers non-zero, a WEEKLY city only rows with both zero. In a DAILY city with a $100 daily row and a $100 weekly row, each on its own draft run, the table shows only the daily row (net $80), yet the two drafts together (net $155) replaced it.

**What changed.** The "shown" query now uses the table's own predicates: the route's city, the automatic city-type rule, then the Payment status, the Route and the View tab. Equality with the full set of rows the open runs hold is kept, so when the table leaves out any row of a run, that run's figures are not shown over its net. No frozen deduction is changed or allocated and no payroll rule changed.

**Test fixture (also from the review).** `freshScenario` made a DAILY city, while the earlier new tests inserted only weekly rows, so they did not represent what the real table would show. `freshScenario` now takes a city type (default DAILY, as before), and the tests that use weekly rows (the approved-run, Paid / Pending / All, two-route and earlier-period cases) use a WEEKLY city.

**Database / config / money:** None. Display only.

**Tested** (`periodSummary.test.js`, database, rolled back, 21 pass; with `statementStore` and `balanceAllocation`, 37 pass): new case for the review's scenario, a DAILY city with a daily and a weekly row each on its own draft: on the All, daily and weekly tabs the runs are not the table's rows and no run net is shown. It fails with the city-type rule removed (checked). The earlier cases pass in a WEEKLY city. The Dashboard, dashboard-folder, Payroll and payroll-folder frontend tests (71) pass; the build passes; no frontend file changed in this round.

**Not tested.** In a browser, and against the real table query inside one transaction (that query uses its own database connection, so it cannot see uncommitted test rows); the predicates are copied from it and covered by the scenario above.

**Risks and follow-ups.** The "shown" predicates are a copy of the table's; if the table's rules change, this check must change with them. A shared helper for "the rows the Dashboard shows" would remove the copy, but it would mean changing `dashboardQueries.js`, which is reserved for Jasil, so it is not done here.
