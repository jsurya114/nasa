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

## Design revised after Jasil's review of #174 (3 Nov 2026): by the record's arrangement, not the whole debt

- **The finding.** Subtracting the whole outstanding debt gave Net Payment -$170.00 for $100 of pay, $20 of insurance and $250 owed, dropped the dates and the approved pay run's net, and disagreed with what payroll does. Jasil was right. I had also misread "deducted by how we create the record": it means the repayment arrangement chosen when the record is created (all on the next payday, or a fixed instalment). The owner confirmed this reading.
- **The rule now.** The **Penalty & Others** row shows what comes off the driver *this payday*, by each record's arrangement, under the recovery limit and the review holds. The whole balance is shown beside it as **Still owed in all** (with Penalties and Others parts) and says that not all of it is due this payday. Only this payday's amount comes off the net.
- **Where this payday's amount comes from (server, `periodSummary.js`).** (1) A finalized pay run inside the dates: its frozen figures (`approved`). (2) Else a draft run's (`draft`, a preview). (3) Else an **estimate**: the existing pay calculator is run on a copy, read-only, saving nothing and locking no row (`loadClaims` and `loadLedger` take a new `lock` flag, default unchanged), so the dashboard shows exactly what the next pay run would take; a test checks the draft run that follows takes the same amounts. (4) No dates: nothing (`none`), and the row says to choose dates. A driver with no pay rows yet still gets the calculator's reasons ("no recovery limit is set", "no repayment arrangement"), shown under the row instead of a silent zero.
- **Net Payment.** Approved run: its frozen net. Draft: its net, labelled preview. Estimate: the table's payment minus insurance minus this payday's amount (never below zero), labelled "preview (before the pay run is approved)". Nothing taken, or no dates: the table's own net, with its usual name. Never the whole debt. While loading or after a failure: "not final" with a retry, as before.
- **Kept:** Filter Data refresh, refresh when the tab is visible again (a completed record lowers what is owed), applied-scope preservation, loading/error/retry, the single "Penalty & Others" label, and the history link.
- **Money impact:** the displayed Net Payment is now payment minus insurance minus this payday's share (preview), or the approved run's net. The $100 / $20 / $250 example with a $50 instalment shows $30.00 (not -$170.00). The actual payout and pay runs are not changed.
- **Tests.** Backend (`periodSummary.test.js`, database): the estimate equals the draft that follows and saves no run; the approved net is the frozen net; no recovery limit gives $0 with the reason; a driver with only records and a held entry gets its flags; no dates gives `none`. Frontend (`Dashboard.penalty.test.jsx`, real Dashboard): the $250 debt with a $50 instalment gives -$50 and a $30 net; approved net $40; draft preview; no recovery limit; no dates; nothing owed; completion on tab return; loading, failure and retry; editing the city; a late reply. `PenaltyRows.test.jsx` (7). Whole backend suite 0 failures (36 skipped); every frontend test file passes; build passes.

## Review fix (Jasil's inline comments on #174, 3 Nov 2026)

- **Daily and weekly together.** The estimate worked out the daily and the weekly run from the same unchanged claim and ledger state, so with $100 of each and one $50 instalment it took $100 where real sequential drafts take $50 then $0 (and a $25 claim showed as $50). Now the daily run is worked out first and what it takes (claims, instalments) and pays (reimbursements) is carried into the weekly one, as a first draft's reservations are for the second, including the "already recovered for an overlapping period" hold. Real drafts for the same period are built daily then weekly, which is the order assumed.
- **Reimbursements and credits.** The browser rebuilt the preview net from the table net, leaving out reimbursements and credit corrections that the pay calculator includes ($100 pay, $20 insurance, $50 reimbursement and a $50 instalment gave a preview of $30; the draft that follows gives $80). The server now returns the calculator's own net for the same earnings (`payday.net`), and the dashboard shows that. When the driver has no closed, unpaid pay rows in the range, nothing can be taken and the table's own net is shown.
- **Tests.** `periodSummary.test.js` (database) builds a driver with $100 of daily and $100 of weekly pay, a $25 claim, a $300 penalty on $50 instalments and a $50 reimbursement, then compares the estimate with the real daily and weekly drafts: deductions $75 in all and net $155 in all, the reimbursement included. It fails on the previous estimate code. `Dashboard.penalty.test.jsx` has the $80 case; `PenaltyRows.test.jsx` covers the net rule. Whole backend suite 0 failures; every frontend test file passes; build passes.
