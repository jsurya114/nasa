# Carrier statements: storage, matching and idempotent publishing (stage 2a)

- Date: 8 November 2026
- Author: Jayasoorya with Claude Code
- Issue: #252; branch `feat/gofo-statement-store` (stacked on `feat/gofo-statement-parser`, PR #253)
- Type and scope: feat(excel). New files only: one migration, `Backend/services/finance/gofoStatement/` (period, matching, store, publish), tests and a test helper.
  No reserved file (`weeklyUploadsController`, `weeklyExcelQueries`, `dashboardQueries`) is touched in this part. Requested by Jasil in Slack on 7 Nov 2026.

## What and why

Company revenue for weekly GOFO cities should be what the carrier billed, kept apart from what NASA pays drivers. This part stores a statement that has already reconciled
(stage 1) and matches it to NASA's recorded work. Nothing calls it yet: the upload route, the pay-screen guards and the reports follow in later parts.

- A statement belongs to ONE fleet, ONE NASA city and ONE ISO billing week (`Week 43-2026` is worked out as Monday to Sunday). The city comes from the routes in the file, never
  from the file name, and its city code must start with the fleet code, so a statement chosen for the wrong city is refused.
- Matching grain is Delivery ID + signing day + route. The carrier lines are added up to that grain, NASA's `payment_dashboard` rows are added up to the same grain, and only then
  are the two joined, so a repeated key can never multiply money. Unmatched groups are kept with a reason (`no_route`, `unknown_route`, `unknown_driver`, `no_pay_group`) and count as
  UNALLOCATED revenue of the statement's city. NASA work the carrier did not bill is counted and reported (`nasaOnly`), not hidden. Every cent must be accounted for or the
  statement is refused.
- Idempotent: the same statement again (any file name, any row order) changes nothing. A corrected statement for the same fleet and week becomes a new version, the old one is marked
  `superseded` and stays for the audit trail. Re-uploading an older version is refused. A voided statement can be uploaded again as a new version.
- Matching can be re-run any time (`rematchOpenGroups`): a group only ever moves from unmatched to matched, so pay data added to the dashboard after the statement is picked up.
- Prepayments, withdrawal fees, claims and ledger adjustments are stored as separate items and are never added to delivery revenue. Nothing is written to `payment_dashboard`, pay
  runs or any payroll table.

## Database

`Backend/migrations/2026-11-08-issue-252-carrier-statements.sql` (safe to run twice; rollback file next to it). New tables `carrier_statements`, `carrier_statement_lines`,
`carrier_statement_items`, `carrier_statement_groups`, `carrier_statement_events`, view `carrier_statement_totals`, and triggers that make lines, items and events append-only,
keep a statement's figures fixed (only its status moves), and let a group move only from unmatched to matched. Run it in one transaction on a copy first, after a backup.
Applied twice on a copy of the local database without error. Rollback drops only these objects.

## Config and dependencies

None.

## Money impact

None. Driver pay, pay runs, rates and the Dashboard are not read or written. Revenue figures only start to use the statement in the reporting part.

## Tested

- `tests/gofoStatementMatch.test.js` (5 tests, no database): the ISO week, grouping with offsets, every match state, NASA rows added up before the join, negative groups.
- `tests/gofoStatementStore.test.js` (1 test with 7 steps, needs `PAYROLL_TEST_DB=1`, runs inside a rolled-back transaction, made-up data): preview stores nothing; publish stores lines, items,
  groups and events; same statement again changes nothing; payroll untouched; later work is matched once and only once; a corrected statement becomes version 2 and an older one
  is refused; a statement that does not reconcile, belongs to another city or has unknown routes is refused with nothing stored; the evidence cannot be edited or deleted; void
  needs a reason and a voided statement can be uploaded again.
- By hand on a copy of the local database with a real Lafayette statement (one week): reconciles, every cent matched to NASA's recorded work except three zero-net groups,
  second publish is a no-op. The amounts are not recorded here because this repository is public.

Not tested: CI skips the database tests (it does not set `PAYROLL_TEST_DB`), so the store test was run by hand against a copy. Not covered yet: the upload route, the screens, the
reports (later parts).

## Risks and follow-ups

The 300-line guideline is exceeded because the migration, store and tests belong together. Part 2b adds the owner-only routes, 3 the pay-screen guards, 4 the reports.
