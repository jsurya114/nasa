# Dashboard: say why the Claims / deductions rows are missing (issue #166, follow-up to #171)

- **Date:** 2026-11-03
- **Author:** Jayasoorya (with Claude Code)
- **Issue / PR:** #166 / see the pull request for this branch
- **Branch:** `fix/dashboard-penalty-empty-states` (from `develop`)
- **Type and scope:** fix(frontend)
- **Files touched:** `Frontend/src/components/Admin/dashboard/usePenaltySummary.js`, `.../dashboard/PenaltyRows.jsx`, tests `PenaltyRows.test.jsx` and `Dashboard.penalty.test.jsx`, this entry. `Dashboard.jsx` and `DashboardTable.jsx` are not changed here.

**What and why.** After #171 the rows appear only when a city, a driver and both dates are applied, the table has rows for that driver, and the driver has a pay run in those dates or a penalty outstanding. When any of that is missing the page showed nothing and gave no reason, so it looked as if the feature was absent. Now:
- city and driver applied but no dates: a row says to choose a start and end date, then Filter Data;
- dates applied but nothing to show: a row says there is no pay run and no outstanding penalty for this driver in those dates.

Loading and error rows from #171 are unchanged. The Claims / deductions rows still sit inside the driver totals block, which needs the driver's delivery rows in the chosen dates.

- **Database:** None. **Config and dependencies:** None. **Money impact:** None (display only).

**Tested.** `PenaltyRows.test.jsx` (5) and `Dashboard.penalty.test.jsx` (8, two new cases on the real Dashboard: dates missing, and nothing to show). Lint is clean on the changed files; `vite build` passes.

**Not tested.** By hand in a browser against real driver data.
