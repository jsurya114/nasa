# Review fix for PR #255: re-match and void are one transaction

- Date: 8 November 2026
- Author: Jayasoorya with Claude Code
- Issue: #252; PR #255; branch `feat/gofo-statement-api`
- Type and scope: fix, `Backend/services/finance/gofoStatement/` (store, service) and the store test. No reserved file.

## What and why

Jasil's review found that the re-match endpoint wrote the match and its audit event as two separate committed queries. If the event write failed, the endpoint reported
a failure after the match had already committed, and a retry found nothing left to match, so the actor was never recorded. The void store method had the same
order: status first, event after.

- `inTransaction` in the store runs a unit of work in one transaction (a pool opens its own; a client already inside a transaction uses a savepoint).
- `rematchStatement` locks the statement row (`FOR UPDATE`), checks it is still published, re-matches and records the event, all together. A void or another re-match
  cannot run in between. It returns nothing for a statement that is not published, and writes no event when nothing matched.
- `voidStatement` changes the status and writes its event in the same transaction.

## Database, config, dependencies

None.

## Money impact

None. Matching rules are unchanged; only the atomicity of the audit record.

## Tested

- `tests/gofoStatementStore.test.js` on a clean local copy of the database (PAYROLL_TEST_DB=1): with the event write forced to fail, a re-match leaves the group
  unmatched and a void leaves the statement published, with no event written; the retry then succeeds and records exactly one event, and a re-match that changes
  nothing writes none. `tests/gofoStatementApi.test.js` passes (15 tests across both files).

Not tested: two admins pressing re-match and void at the same moment (the row lock is what serialises them; I did not run a concurrent test).
