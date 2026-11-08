# Review fix for PR #257: a record's revenue is every group matched to it

- Date: 8 November 2026
- Author: Jayasoorya with Claude Code
- Issue: #252; PR #257; branch `feat/gofo-reporting`
- Type and scope: fix, the reporting revenue view migration and its test. No reserved file.

## What and why

Jasil's review found that `reporting.delivery_facts` chose ONE statement per record (the highest version) and summed only that statement's groups. When a later billing
week carries an offset for an earlier day and a re-match anchors it to the same record that the earlier week already bills, two statements pointed at one record, the
view used only one of them, and total revenue jumped (a -1.80 offset disappeared) while the offset also left the unallocated view.

- A record's revenue is now the sum of every active (published-statement) group matched to it, whichever statement and billing week it is in.
- The statement that covers the record's week now only decides whether a weekly record is billed at all (zero when the carrier billed nothing) and which statement id is
  shown. It never selects which groups count.
- Driver earnings are the record's own single stored amount, so they are counted once however many statements point at it.

## Database

`CREATE OR REPLACE VIEW reporting.delivery_facts` in `2026-11-08-issue-252-reporting-statement-revenue.sql`, same column names, order and types (columns are only appended
as before). The migration stays safe to run twice; re-running it on a database that has the first draft replaces the view. Rollback is unchanged. Applied to local copies only.

## Money impact

None for figures that had one statement per record. Where two statements point at one record, the total is now the sum of both instead of whichever won.

## Tested

- `tests/revenueDefinition.test.js` on a clean local copy of the database (PAYROLL_TEST_DB=1), new two-week regression: week 43 bills 2.61 on a record; week 44 carries a
  -1.80 offset signed on the same day, unmatched at first (total 3.11, unallocated 0.50); after a re-match the offset is matched to that record and the total is still 3.11,
  unallocated back to 2.30, driver earnings 5.00 once, the record's revenue 0.81, and the daily trend shows 0.81. Against the previous view the same test fails (4.91, not 3.11).
- `tests/gofoStatementStore.test.js` still passes (17 tests across both files).

Not tested: a production-size table for the view's per-record subquery (it filters on `payment_dashboard_id`, which has an index on the groups table from the statement migration).
