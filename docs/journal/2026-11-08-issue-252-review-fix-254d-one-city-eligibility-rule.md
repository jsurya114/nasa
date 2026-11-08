# Review fix (#254): matching uses the same city eligibility rule as reporting

- Date: 8 November 2026
- Author: Jayasoorya with Claude Code
- Issue: #252; PR: #254 (review by Jasil); branch `feat/gofo-statement-store`
- Type and scope: fix(excel), backend and database trigger. No reserved file is touched.

## What and why

Jasil found that matching and reporting disagreed about a half-set sequence range (one end zero, the other not). The matcher treated it as weekly work and
attached the carrier's revenue to it, but reporting (`counts_for_city`) counts a weekly city's row only when both sequence numbers are zero. The matched
revenue therefore vanished from city revenue and was also missing from the unallocated bucket.

Now there is one rule, written once (`WEEKLY_ROW` in `statementStore.js`): both sequence numbers are zero. It is used by the first match, by every
re-match and by the final hold-and-recheck. A group whose only candidate is a half-set (or NULL) row stays unallocated and visible until the journey is fixed,
and the next re-match picks it up. The journey guard trigger uses the same single classification (the migration is re-runnable; the trigger is replaced).

## Database

`2026-11-08-issue-252-carrier-statements.sql`: the `carrier_statement_work_guard_update` trigger condition now compares only whether the row counts for its
weekly city (both zero), plus driver, route and day. Nothing else changes; rollback is unchanged.

## Money impact

None to pay. Fewer groups can be matched (only to rows reports count), so unallocated revenue can be higher than before for half-set journeys, and it is
visible. Nothing is lost.

## Tested

- New database test (rolled back): a half-set range present before matching leaves the $2.61 group unallocated (matched 2.30, unallocated 2.61); re-matching
  leaves it alone; once fixed it matches; every matched row counts for its city. Also a half-set edit that slipped past the trigger is caught by the hold check.
  Both fail on the old rule (checked).
- Statement store/guard/API/match tests with the database: pass. CI-style backend run: 224 pass, 0 fail.

Not tested: a true two-connection race; the revenue figures in reporting views (that migration belongs to #257).

## Risks and follow-ups

Matching is stricter by design. Rows with NULL sequence numbers are no longer matched either; reports never counted them.
