# Review fix for PR #254: one live statement per city and week

- Date: 8 November 2026
- Author: Jayasoorya with Claude Code
- Issue: #252; PR #254; branch `feat/gofo-statement-store`
- Type and scope: fix, `Backend/services/finance/gofoStatement/` (publish, store), the carrier statements migration and the store test. No reserved file.

## What and why

Jasil's review found that the same city and billing week could hold two live versions when a correction spelled the fleet differently (`TST-NLC` then `TST NLC`)
and carried a new bill number: the version lookup, the lock and the database constraint were all keyed on the fleet text, so the second upload looked like a new week.

- The grain is now the verified city. The city is found from the statement's routes and the fleet must match that city's code, so the lookup in preview, the week lock,
  the version number and the "one live statement" rule all use `city_id` and the billing week start.
- The fleet text is still stored as written, for display only.

## Database

The migration is edited in place (it has not been run on a shared database). It is re-runnable, so a database that already ran the first draft converges:

```sql
DROP INDEX IF EXISTS carrier_statements_one_published;
CREATE UNIQUE INDEX IF NOT EXISTS carrier_statements_one_published_per_city
  ON carrier_statements (carrier, city_id, period_start) WHERE status = 'published';
CREATE UNIQUE INDEX IF NOT EXISTS carrier_statements_city_version_once
  ON carrier_statements (carrier, city_id, period_start, version);
```

Rollback is unchanged (the table, with its indexes, is dropped). Applied to my local copies only; no data was changed.

## Money impact

None. Revenue totals are unchanged; the fix stops a week from being counted twice.

## Tested

- `tests/gofoStatementStore.test.js` on a clean local copy of the database (PAYROLL_TEST_DB=1): the correction now uses a different fleet spelling and a new bill number,
  yields version 2, leaves exactly one published row, and a direct insert of a second live row under another fleet text is refused by the database. 19 tests pass with the parser tests.

Not tested: a shared or production-size database (the new indexes build instantly on an empty table).
