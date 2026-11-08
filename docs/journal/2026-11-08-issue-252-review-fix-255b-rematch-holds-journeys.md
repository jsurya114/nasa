# Follow-up for PR #255: a re-match also holds the journeys it attaches

- Date: 8 November 2026
- Author: Jayasoorya with Claude Code
- Issue: #252; PR #255; branch `feat/gofo-statement-api`
- Type and scope: fix, `statementStore.js`, `router.js` and the API test. No reserved file.

## What and why

PR #254 now locks and re-checks the journeys a statement is matched to when it is published (see its second journal entry). The re-match endpoint attaches journeys later, so it does the
same: after matching, the newly attached pay rows are held (`FOR SHARE`) and re-checked for driver, route and day inside the same transaction as the match and its audit event.
If anything changed meanwhile the whole re-match is undone and the endpoint answers 409 "A journey changed while the statement was being matched. Nothing was changed. Try again."

## Database, config, dependencies

None. Money impact: none.

## Tested

- `tests/gofoStatementApi.test.js` (the 409 answer), `gofoStatementStore.test.js` and `gofoStatementWorkGuard.test.js` on a clean local database copy: 17 pass.

Not tested: a true two-connection race on the re-match.
