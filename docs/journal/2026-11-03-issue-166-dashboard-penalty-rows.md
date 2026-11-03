# Dashboard: Claims / deductions rows below the insurance deduction (issue #166, part 5)

- **Date:** 2026-11-03
- **Author:** Jayasoorya (with Claude Code)
- **Issue / PR:** #166 / see the pull request for this branch. **Stacked on part 4** (the dashboard period summary endpoint, which itself sits on the settlements PR).
- **Branch:** `feat/dashboard-penalty-row` (from `feat/dashboard-period-summary`)
- **Type and scope:** feat(frontend)
- **Files touched:**
  - new: `Frontend/src/components/Admin/dashboard/usePenaltySummary.js`, `.../dashboard/PenaltyRows.jsx`, test `.../dashboard/PenaltyRows.test.jsx`;
  - changed: `Dashboard.jsx` and `DashboardTable.jsx` (**reserved files, edits approved by Jasil for #166 on 3 Nov 2026**: the hook is read once and passed down, a few Summary entries are added, one component is placed below the insurance row), `Payroll.jsx` (opens on a city and driver named in the link), test `Payroll.test.jsx`;
  - this entry.

**What and why.** For the driver, city and dates the admin applied, the totals block under the table now shows, directly below the insurance deduction:
1. **Claims / deductions this payday:** what the pay runs inside those dates took (claims and recoveries), marked **Approved** (finalized) or **Preview** (draft). Never the whole debt: a $300 debt with a $50 instalment shows $50 here.
2. **Penalties still outstanding:** what is left after pay runs and settlements, with "other debts" noted, and a link **View entries and history** that opens the Payroll page on that city and driver.
3. **Pay run net (approved or preview):** the pay run's own net.

The same three figures appear in the Summary panel. If a pay run crosses the chosen dates, the row says it is not counted.

**Net payment, on purpose.** The existing "Net Payment" (driver payment minus insurance) is unchanged. Following Jasil's rule, the penalty is not subtracted from it: for an approved run the pay run's frozen net is the one net, and the Claims / deductions row only explains a deduction already inside it. The rows are shown only when a city, a driver and both dates are chosen, and nothing is asked of the server before that.

Everything comes from `GET /admin/payroll/drivers/:id/dashboard-summary` (part 4). Nothing is calculated in the browser. An error hides the rows and leaves the dashboard as it was.

- **Database:** None.
- **Config and dependencies:** None.
- **Money impact:** none. The dashboard's own totals and Net Payment are unchanged; the new rows only display server figures.

**Tested.** `PenaltyRows.test.jsx` (5): $50 this payday against $250 outstanding with the pay run's net and the history link; a draft labelled preview and never approved; only the outstanding row when no run is in the dates; a crossing run is reported; nothing is shown while loading, on error or with nothing to show. `Payroll.test.jsx` (7) includes the link: it opens on the named driver and ignores a bad link. `vite build` passes. Lint: the 7 errors in `Dashboard.jsx` and `DashboardTable.jsx` were there before (issue #40); none are new.

**Not tested.** By hand in a browser (the local database has no dashboard rows after the earlier clean-up); a real approved run.

**Risks and follow-ups.** The rows use the applied filters; if the admin changes the city in the form without clicking Filter, the list of drivers changes but the rows stay for the applied filter. The Edit and Mark complete buttons are the next PR.
