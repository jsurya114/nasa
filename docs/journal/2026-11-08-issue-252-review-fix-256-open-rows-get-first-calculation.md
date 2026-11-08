# Review fix for PR #256: open work can always get its first pay calculation

- Date: 8 November 2026
- Author: Jayasoorya with Claude Code
- Issue: #252; PR #256; branch `feat/gofo-pay-guards`
- Type and scope: fix, `Backend/services/finance/payGuards.js` and its test. The reserved file `dashboardQueries` is not touched again in this fix.

## What and why

Jasil's review found that a published statement protected every weekly row dated inside its week, including an unclosed row with no driver payment and no carrier
match. Calculate Payment skipped it as "protected", so it could never close and enter a pay run.

- The statement protection now applies only to a row that is already closed and has a driver payment. A row with no driver payment yet is open work and receives its
  first calculation exactly as before.
- Unchanged: rows that are an earning on an approved or paid pay run stay protected, and so do already calculated rows that are matched in a verified statement or
  fall in its week and city.

## Database, config, dependencies

None.

## Money impact

None for existing figures: no already calculated, reconciled row can change. The only newly calculable rows are rows that had no driver payment.

## Tested

- `tests/payGuards.test.js` on a clean local copy of the database (PAYROLL_TEST_DB=1): a weekly row in the statement week with no pay and no carrier match now becomes
  7.50 / 5.00 and closed; the pay-run earning, the matched row and the already calculated same-week row stay untouched; voiding the statement frees the matched row.
  The new assertion fails against the previous guard.

Not tested: a row that is matched in a statement but still has no driver payment. It is now treated as open work and may be calculated; the group keeps its own
recorded driver amount from when it was matched, so the reconciliation record is not rewritten.
