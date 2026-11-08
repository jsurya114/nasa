# Third review fix for PR #254: sequence edits and one safe re-match for every caller

- Date: 8 November 2026
- Author: Jayasoorya with Claude Code
- Issue: #252; PR #254; branch `feat/gofo-statement-store`
- Type and scope: fix, the carrier statements migration, `statementStore.js` and tests. No reserved file. The branch also merges `develop` after #253 was squash-merged (no conflicts left).

## What and why

Two findings from Jasil's latest review.

1. **Sequence-number edits.** Changing a matched weekly journey's start and end sequence numbers from zero to non-zero changes how it is classified (weekly or not, and whether a weekly
   city counts it), so its carrier revenue stopped appearing in city revenue while the group stayed matched and was not unallocated either. The journey guard now also fires when an edit
   changes either classification: "weekly" for matching and the reporting source (no sequence number on either end), and "counted by a weekly city" (both zero). Saving the same classification
   is unaffected, and a journey no statement bills is free. After a void it is free too.
2. **One safe re-match.** `rematchOpenGroups` now holds and re-checks the pay rows it attaches (`holdMatchedWork`) for every statement it touched, and throws `StatementWorkChanged` if a journey changed,
   so each caller's transaction or savepoint undoes the match. This covers the automatic re-match after a weekly Excel add (PR #256 handles its savepoint) as well as the manual one (#255).

## Database

`carrier_statement_work_guard_update` is recreated: it now also fires for `start_seq` and `end_seq` and the WHEN clause compares both classifications. Re-runnable; rollback unchanged.

## Money impact

None to stored amounts; it stops an edit that would have hidden verified revenue from the reports.

## Tested

- `gofoStatementWorkGuard.test.js` on a clean local copy of the database (PAYROLL_TEST_DB=1), through the journey screen's own update (`updateJourneyById`): giving a matched weekly journey sequence numbers
  (1 and 10) or a half-set range (0 and 5) is refused, the same classification (0 and 0) is accepted, a journey the statement does not carry can change, the matched journey still counts for its city, and
  after a void it is free. The sequence assertions fail against the previous trigger. A unit test shows `rematchOpenGroups` throws when the recheck fails and returns the count when it passes.
- `gofoStatementStore.test.js` passes (10 across both files).

Not tested: a true two-connection race on the automatic re-match (only the recheck is simulated).
