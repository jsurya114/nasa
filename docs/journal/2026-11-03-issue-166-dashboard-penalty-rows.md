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

## Review fix (Jasil's review on #171, 3 Nov 2026)

- **Two nets on one screen.** The pay run's net was shown next to a green "Net Payment" that still excluded claims and recoveries ($40 and $80 for $100 of pay, $20 of insurance and $40 deducted). Now one net is payable. When a pay run covers the dates, the pay run's net is the green **Net Payment (approved pay run)**, in the table and in the Summary; a draft is an amber **Net Payment preview (draft pay run, not approved)**. The older "payment minus insurance" line stays only as an explanation, relabelled **Net before claims / recoveries** and muted. Nothing is subtracted twice. With no pay run in the dates, the older line keeps its usual name and the outstanding row says nothing has been deducted yet.
- **No silent gaps.** Once a city, a driver and both dates are chosen, payroll figures are expected. While they load, a row says the net below does not yet include claims or recoveries; if they fail, an alert row says not to treat it as the amount to pay and offers **Try again** (the older net is marked "not final" meanwhile); the Summary shows the same notice. Before, a failure hid the rows and left an unadjusted amount looking payable.
- **Where.** `penaltyDisplay.js` holds the wording (net line, pay run net, Summary lines and colours); `PenaltyRows.jsx` adds `PayRunNetRow`; `Dashboard.jsx` and `DashboardTable.jsx` use them (reserved files, edits approved for #166).
- **Tests.** `Dashboard.penalty.test.jsx` mounts the real Dashboard with a fake server: approved (one payable net in the table and the Summary, the older one explained, no second "Net Payment"), preview, loading, a failed summary with a retry that recovers, and no dates (nothing asked, usual name). `PenaltyRows.test.jsx` (5) updated. Whole frontend suite passes file by file; lint has only the 7 existing errors in `Dashboard.jsx` and `DashboardTable.jsx` (#40); `vite build` passes.
- This branch includes the #170, #168 and #167 fixes (the outstanding split now reconciles).

## Review fix 2 (Jasil's re-review on #171, 3 Nov 2026)

- **Payroll figures lost when the form is edited.** The hook found the applied driver's ID in the current dropdown options. Those options are replaced as soon as the admin changes the city in the form, before Filter Data, while the table still shows the applied driver. The driver was then missing from the options, the figures vanished, and the older net came back as an ordinary Net Payment.
- **Now the scope is fixed when the filters are applied.** Pressing Filter Data records the chosen city and driver IDs by name (`rememberScope`); the applied filters are matched to that record, not to whatever the dropdowns hold later. Without a record the current options are used, as before.
- **A scope's figures belong to that scope.** Each result carries its scope (city, driver, dates). For the render between a new scope arriving and its request starting, the page shows the loading state, not the previous scope's figures, and a reply that arrives after its scope was replaced is ignored.
- **Tests (real Dashboard, fake server):** editing the city before applying keeps the applied driver's approved net, keeps the older net labelled "before claims / recoveries", never shows a plain Net Payment, and asks nothing again; applying another driver while the first reply is held shows the loading state, then the new driver's figures, and the late first reply does not replace them. The first test fails without the fix.
- Merged `develop` (which now has #167 to #170 and #172); one import line in `Payroll.jsx` conflicted and both sides were kept.
