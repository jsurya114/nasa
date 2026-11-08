# Second review fix for PR #257: a cross-week offset is added to an estimate, never replaces it

- Date: 8 November 2026
- Author: Jayasoorya with Claude Code
- Issue: #252; PR #257; branch `feat/gofo-reporting`
- Type and scope: fix, the reporting revenue view migration and its test. No reserved file.

## What and why

Jasil's re-review found that when an earlier week had no active statement (never published, or voided) and a later week's statement carried an offset matched to a record of that week,
the view treated the record as statement-billed: the record's revenue became the offset alone (-1.80, basis "statement") and its stored 4.00 estimate was lost.

A record's revenue is now its base plus cross-week money:

- Base: the fees of the statement that covers the record's billing week (zero if the carrier billed nothing for it); if no statement covers that week, the stored estimate
  (driver plus company earnings) when both are known. A statement replaces the estimate only for the week it covers.
- Cross-week money: groups of other published statements matched to the record are added on top, whichever the base is. The basis label stays "estimated" when the base is an
  estimate. With neither a covering statement nor an estimate, the cross-week money is shown on its own as "statement" revenue, and the record is not complete.
- The record's `statement_id` is now the covering statement only, so a later statement's economics do not take the earlier week's driver cost.
- Margin is revenue less the record's own driver earnings, counted once.

## Database

`CREATE OR REPLACE VIEW reporting.delivery_facts` in `2026-11-08-issue-252-reporting-statement-revenue.sql`: same column names, order and types. Re-runnable; rollback unchanged. Applied to local copies only.

## Money impact

None where a record is covered by its own week's statement or carries no cross-week money. Where an offset from another week is matched to a record whose own week has no statement, revenue is now estimate plus offset instead of the offset alone.

## Tested

- `tests/revenueDefinition.test.js` on a clean local copy of the database (PAYROLL_TEST_DB=1), new case: week 43 voided, so the record for the 19th is back to its 4.00 estimate; week 44's -1.80 is added:
  revenue 2.20, margin -0.80, basis "estimated", the daily trend 2.20, no unallocated money. Against the previous view the same test fails with -1.80, -4.80 and "statement". The earlier two-week test (both weeks
  published: 0.81) and `statementEconomics.test.js` still pass.

Not tested: a record whose earlier week never had any statement at all (the voided case is the same state to the view: no covering statement), and a production-size table.
