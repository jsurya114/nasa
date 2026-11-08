# Second review fix for PR #254: editing or deleting a journey that carries verified revenue

- Date: 8 November 2026
- Author: Jayasoorya with Claude Code
- Issue: #252; PR #254; branch `feat/gofo-statement-store`
- Type and scope: fix, the carrier statements migration (+ rollback), one small helper, `adminJourneyController` (a 409 answer) and a new integration test. No reserved file.

## What and why

Jasil's re-review found that a journey matched to a statement could still be moved to a route of another city (its verified revenue then vanished from the original city,
because the reporting join no longer found the group), and that deleting it failed with a foreign key error (23503) even after the statement was voided.

- Evidence and work link are separated: the three links on a statement group (pay row, driver, route) are now plain ids, not foreign keys. The statement is immutable evidence
  and can no longer block, or be broken by, a journey edit or delete. A database that ran the first draft has the three foreign keys dropped by the migration (data stays).
- While a statement stands, a database trigger on `payment_dashboard` refuses to change the driver, route or day of a pay row that carries a matched group of a published
  statement, or to delete it (SQLSTATE `CS001`). The journey screens answer 409 with a plain message: void the statement, change the journey, publish again.
  Other edits (packages, sequence numbers, pay figures, an edit that does not move the journey) are unaffected. A journey the statement does not carry is free.
- The supported correction path is therefore: void the statement (its lines, groups and events stay as history), fix or delete the journey, publish the statement again.
  A voided or replaced statement no longer guards anything.

## Concurrency (from an automated security review of the first version of this fix)

Without the foreign keys, a journey moved or deleted between matching and commit could have left a published statement pointing at work that is no longer there. Publishing now
locks the matched pay rows (`FOR SHARE`, until the transaction ends) and re-checks that each still exists with the same driver, route and day; if not, nothing is stored and the owner
is told to check the statement again. A journey edit that arrives meanwhile waits for the publish to finish and is then refused by the guard. The re-match path does the same (see PR #255).

## Database

The `carrier_statement_groups` columns `route_id`, `driver_id`, `payment_dashboard_id` lose their foreign keys (`DROP CONSTRAINT IF EXISTS` for databases from the first draft);
new function `carrier_statement_work_guard()` and triggers `carrier_statement_work_guard_delete` and `carrier_statement_work_guard_update` on `payment_dashboard`
(the update trigger fires only when driver, route or day actually changes). Re-runnable. The rollback drops the triggers and the function first.

## Money impact

None to any stored amount. An edit that would have silently moved verified revenue to another city is refused.

## Tested

- New `tests/gofoStatementWorkGuard.test.js` on a clean local copy of the database (PAYROLL_TEST_DB=1): moving a matched journey to another city's route, another driver or another
  day, and deleting it, are all refused and revenue is unchanged; packages edits and a journey the statement does not carry are free; after the void it can be moved and deleted,
  the voided statement keeps all its evidence, and the same statement can be published again.
- `tests/gofoStatementStore.test.js` still passes.

Not tested: a true two-connection race (the test simulates an edit that slipped past the trigger), the journey screens in a browser, and deleting a driver or route that appears in a voided statement (their pay rows already prevent that, as before). The guard protects the
pay row that carries the revenue (the lowest id of the driver, route and day); other rows of the same driver, route and day are not guarded because they do not carry revenue.
