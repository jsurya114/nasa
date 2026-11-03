# Dashboard: penalties and others below the insurance deduction, taken off the net (issue #166, owner's rule)

- **Date:** 2026-11-03
- **Author:** Jayasoorya (with Claude Code)
- **Issue / PR:** #166 / see the pull request for this branch
- **Branch:** `feat/dashboard-deductions-net` (from `develop`)
- **Type and scope:** feat(frontend), plus a small backend change (dates optional on the dashboard summary call)
- **Files touched:**
  - frontend: `Dashboard.jsx` and `DashboardTable.jsx` (reserved; edits approved by Jasil for #166), `dashboard/penaltyDisplay.js`, `dashboard/PenaltyRows.jsx`, `dashboard/usePenaltySummary.js`, tests `PenaltyRows.test.jsx` and `Dashboard.penalty.test.jsx`;
  - backend: `services/payroll/statements/periodSummary.js`, test `tests/periodSummary.test.js`;
  - this entry.

**This replaces the design of #171 on purpose.** The owner decided on 3 Nov 2026: *when an admin saves a penalty, the dashboard shows it straight away below the insurance deduction and takes it off the net payment; Summary gets Penalties and Others; no dates and no pay run needed.* Jasil's earlier rules (this payday's share only; the approved pay run's net as the one net) are set aside for the dashboard. The pay-run side (drafts, approval, instalments, settlements) is unchanged.

**What the admin sees.** For the applied city and driver:
- below **Insurance Deduction**: a **Penalties** row (hand-entered claims) and an **Others** row (advances, expenses, carrier claims), each in red, shown only when something is owed. Penalties carries the link **View entries and history**;
- **Net Payment = driver payment - insurance - penalties - others**, in the table and in the Summary;
- the older "this payday", "outstanding" and "pay run net" lines of #171 are removed, so there is one net and it is this one.

**Where the amounts come from.** The server's outstanding balances (`outstanding.penalties` and `outstanding.other`), the same split the Payroll page shows: after repayments outside payroll, settlements and waivers, and what an approved pay run already took. So **marking an entry complete, repaid or waived lowers the row**, and an edit changes it. The dashboard asks again each time **Filter Data** is pressed (and when the page is opened), so a record saved or completed since then shows up.

**Safety.** While the amounts load, or if they cannot be loaded, a row says so and the net is labelled "not final" (retry offered), so an unadjusted net never looks payable. The applied city and driver are remembered when Filter Data is pressed, so editing the city in the form does not lose them; a late reply for an earlier driver is ignored.

**Backend.** `GET /admin/payroll/drivers/:id/dashboard-summary` now takes `from` and `to` as optional (both or neither; one alone is a 400). Without them only the outstanding figures are returned and the pay-run part is empty.

**To confirm (money).** The dashboard net is now payment minus insurance minus what is still owed. A deduction that an approved pay run already took is no longer outstanding, so it is not taken twice here. The actual payout (the existing Pay buttons and any pay run) is not changed by this PR.

- **Database:** None. **Config and dependencies:** None.
- **Money impact:** the displayed Net Payment changes for a driver with penalties or other debts outstanding. Example (tests): payment $100, insurance $20, penalties $25, others $10 gives Net Payment $45.00 (was $80.00).

**Tested.** `Dashboard.penalty.test.jsx` (7, real Dashboard with a fake server): the two rows right below insurance and the net in the table and the Summary, no dates; nothing owed gives no row and the old net; penalties only with the history link; a later change shows after Filter Data; loading, failure and retry; editing the city before applying; a late reply for another driver. `PenaltyRows.test.jsx` (5). `periodSummary.test.js` (9, database, includes no dates and half a range). Whole backend suite 0 failures (36 skipped by the other switch); every frontend test file passes; `vite build` passes. Lint: only the 7 existing errors in `Dashboard.jsx` and `DashboardTable.jsx` (#40).

**Not tested.** By hand in a browser against real driver data (the local database holds no deliveries right now).

## Follow-up (owner, 3 Nov 2026): one "Penalty & Others" line, and refresh when a record is completed

- **One line.** The Penalties and Others rows are now one row labelled **Penalty & Others**, directly below the insurance deduction, with the total on the right and the two parts beside the label ("Penalties $25.00 · Others $10.00"; a part that is zero is left out). The Summary has the same single **Penalty & Others** line. Net Payment is unchanged: payment - insurance - penalties - others.
- **Completing a record lowers it.** A record marked complete (repaid outside payroll or waived) already lowers what is outstanding, so it comes off Penalty & Others and the net goes up by the same amount. To make that show without pressing Filter Data, the dashboard now also asks again when its tab becomes visible again (for example after returning from the Payroll page), as well as on Filter Data and when the page is opened.
- **Tests:** the real Dashboard shows one row in the right place with the breakdown; a $20 completion lowers the row from $35 to $15 and raises the net from $45 to $65, then the rest of the penalty leaves only Others ($70 net); `PenaltyRows.test.jsx` updated. All frontend test files pass; build passes; lint has only the 7 existing errors.
- **Not changed:** database, backend, money rules, payout.
