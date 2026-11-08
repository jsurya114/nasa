# Calculate Payment cannot overwrite settled or reconciled rows; statements match late work (stage 3a)

- Date: 8 November 2026
- Author: Jayasoorya with Claude Code
- Issue: #252; branch `feat/gofo-pay-guards` (stacked on `feat/gofo-statement-api`, PR #255, stacked on #254 and #253)
- Type and scope: feat(excel). **Reserved files edited at Jasil's request (his Slack message of 7 Nov 2026 asks for exactly this guard): `Backend/services/admin/dashboardQueries.js`
  (the two Calculate Payment queries) and `Backend/services/admin/weeklyExcelQueries.js` (one best-effort step in "add staged weekly data").** Also `dashboardController.js` (the
  response text), new `Backend/services/finance/payGuards.js`, new test. Jasil: please review those hunks.

## What and why

- **Guard.** "Calculate Payment" recalculated every open (`paid = false`) Dashboard pay row from today's route rates. That could change a figure that is already settled or reconciled.
  One definition (`payGuards.js`) now protects a row when (1) it is an earning line on a pay statement (an approved pay run freezes its earnings), or (2) it is part of a published,
  verified carrier statement (matched by the statement, or a weekly row of that city inside the statement's billing week). Protected rows are left exactly as they are. Every other
  row is recalculated by the same formula as before. The two near-identical queries (all dates, one date) are now one function, so the guard cannot be forgotten in one of them.
- **Honest feedback.** The response now says how many rows were left alone (`protectedRows`, and a sentence in `message` only when there are any), instead of skipping silently.
  A city admin's job list still limits what is recalculated and counted.
- **Late work.** A statement published before the week's work reached the Dashboard has unmatched groups. After "add staged weekly data to the dashboard" stores its rows, the open
  groups are matched in a savepoint: matching never changes what the weekly add stores, and a database without the statement tables skips the step. Matching only moves a group from
  unmatched to matched.

## Database, config, dependencies

None (uses the tables from PR #254; `to_regclass` checks that they exist before the guard refers to them, so an older database behaves as before).

## Money impact

Pay rows in an approved pay run or a verified statement are no longer recalculated. For every other row the result is unchanged. Before and after on a copy of the local database:
the open, daily-type and unprotected rows change exactly as before; the protected rows keep their stored amounts to the cent (see the test).

## Tested

- `tests/payGuards.test.js` (needs `PAYROLL_TEST_DB=1`, rolled-back transaction, made-up data): an open row and a daily-type row are recalculated (7.50 and 5.00 from the rates); a pay-run
  earning, a row matched in a verified statement and a weekly row inside a verified statement's week keep a stale stored amount; the protected rows are counted; a job outside a city
  admin's list is neither touched nor counted; once the statement is voided its rows are ordinary again while the pay-run earning stays protected.
- By hand on a copy of the local database: the weekly add runs with the new step, both with and without the statement tables.

Not tested: CI skips the database tests; Calculate Payment from the screen; the weekly add with unmatched statement groups end to end (the matching itself is covered by the stage 2a test).

## Risks and follow-ups

Weekly rows that were never matched by a statement and are not in a pay run are still recalculated from route rates, as before; stage 3b stops relying on the company rate fields.
