# Dashboard figures for one driver and period: this payday and what is still outstanding (issue #166, part 4)

- **Date:** 2026-11-03
- **Author:** Jayasoorya (with Claude Code)
- **Issue / PR:** #166 / see the pull request for this branch. **Stacked on part 2** (settlements): the outstanding figure reads settlements.
- **Branch:** `feat/dashboard-period-summary` (from `feat/ledger-settlements`)
- **Type and scope:** feat(payroll), backend, read-only
- **Files touched:** new `Backend/services/payroll/statements/periodSummary.js`, test `Backend/tests/periodSummary.test.js`; changed `statementController.js` and `routes/payrollRoutes.js` (one handler and one route); this entry. No reserved files.

**What and why.** The dashboard's Claims / deductions row needs two different numbers, not one (Jasil, 3 Nov 2026):
- **This payday:** the claim deductions and recoveries taken on the pay runs inside the dashboard's date range, split into **approved** (finalized, frozen) and **preview** (drafts), each with the pay run's own net. The status is `approved` when any finalized run is inside, `preview` for drafts only, `none` otherwise.
- **Still outstanding:** what the driver still owes after pay runs and settlements, with hand-entered penalties shown apart from the rest (carrier claims, advances, expenses).

A run counts only when its **whole** period lies inside the range, so one deduction is never spread over daily rows or counted for two ranges. A run that crosses the range edge is reported as `crossingRuns` and not counted. Nothing is calculated or recalculated here; every figure is read from existing statements and balances, so the dashboard never shows a second, independent net.

`GET /admin/payroll/drivers/:driverId/dashboard-summary?cityId=&from=&to=` (admin, super admin). The city is required and checked against the admin's cities; the driver must belong to the city (404 otherwise); dates must be real and in order (400).

Not in this part: the dashboard screen (next PR) and the Payroll page buttons.

- **Database:** None.
- **Config and dependencies:** None.
- **Money impact:** None. Read-only.

**Tested.** `periodSummary.test.js`, 6 database steps in one rolled-back transaction, made-up data: before any run (nothing deducted, outstanding split); a draft is a preview with the statement's own net; finalizing makes it approved with the frozen net, and outstanding plus the payday's share equals the debt (never the full amount subtracted); a crossing range, a wider range and a later range; an outside repayment lowers the outstanding penalty only; bad dates, wrong city, a driver of another city. Whole backend suite: 153 pass, 0 fail, 36 skipped.

**Not tested.** The HTTP route with real tokens; production data.

**Risks and follow-ups.** A range that cuts across a pay run shows no deduction and `crossingRuns`; the screen should say so.
