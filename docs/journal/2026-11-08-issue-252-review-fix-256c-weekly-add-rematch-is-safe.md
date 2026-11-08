# Third review fix for PR #256: the re-match after a weekly add is safe and never fails the add

- Date: 8 November 2026
- Author: Jayasoorya with Claude Code
- Issue: #252; PR #256; branch `feat/gofo-pay-guards`
- Type and scope: fix, `weeklyExcelQueries.js` (reserved; one block replaced by a call), a new `matchAfterWeeklyAdd.js` and its test. The branch also merges `develop` after #253 was squash-merged.
  Jasil asked for this change in his review; the hunk is small and marked for his eyes.

## What and why

Jasil's review found that adding staged weekly work called the re-match directly, so it skipped the hold-and-recheck of the linked pay rows that the manual re-match has, and a concurrent journey
deletion could commit a matched group with no pay row behind it.

- The hold-and-recheck now lives in `rematchOpenGroups` itself (PR #254), so every caller has it.
- The weekly add calls one helper, `matchAfterWeeklyAdd`, which runs the re-match in a savepoint of the add's transaction. If a journey changed meanwhile, or anything else fails, the match is
  undone, the weekly import is kept exactly as it was and is not failed, and the groups stay unmatched for the next add or the owner's "Match again". A changed journey is logged as a warning, anything
  else as an error; an older database without the statement tables is skipped quietly.
- The weekly insert, the amounts it stores and its return values are unchanged (the number of matched groups is still reported as `statementGroupsMatched`).

## Database, config, dependencies

None.

## Money impact

None. Matching never changes what the weekly add stores.

## Tested

- `tests/matchAfterWeeklyAdd.test.js` (3 tests, no database needed): when every attached journey holds, the match is kept and counted; when the recheck fails the savepoint is rolled back, nothing is
  thrown to the weekly add and it is logged as a warning; any other failure is rolled back and logged as an error, and a missing statement table is skipped quietly.
- `payGuards.test.js` and `gofoStatementStore.test.js` on a clean local copy of the database pass.

Not tested: a true two-session race with a real weekly Excel upload, and a before-and-after run of a real weekly workbook (the amounts the add stores are not touched by this change).
