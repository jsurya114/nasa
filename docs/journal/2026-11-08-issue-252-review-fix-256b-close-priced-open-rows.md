# Second review fix for PR #256: priced open rows can finish their close transition

- Date: 8 November 2026
- Author: Jayasoorya with Claude Code
- Issue: #252; PR #256; branch `feat/gofo-pay-guards`
- Type and scope: fix, `payGuards.js`, the reserved files `dashboardQueries` (one extra update in the recalculation) and `dashboardController` (one sentence in the message), and the test.
  Jasil asked for these reserved-file changes in his review; the hunks are small and marked for his eyes.

## What and why

Jasil's re-review found that after the first fix, a weekly row that already has a driver amount but is not closed was kept as it is and never closed, and the pay run loads closed
rows only, so it stayed stranded.

- Calculate Payment now closes such a row (sets `closed = true`) without touching its driver payment or company figure. Any row that is an earning on a pay statement is never touched at all.
- The response and message say how many of the protected rows were only closed (`closedOnly`).
- A fresh row (no driver payment) is still calculated in full and closed, as before.

## Database, config, dependencies

None.

## Money impact

None. No amount of any existing row changes; only the closed flag of a priced open row inside a verified statement week or matched group.

## Tested

- `tests/payGuards.test.js` on a clean local copy of the database (PAYROLL_TEST_DB=1), extended as Jasil suggested: after Calculate Payment, the real pay-run earnings loader
  (`loadEarnings`) returns both the fresh row (at its first calculation) and the priced open row (at the amount it already had); the matched row and the pay-run earning are left exactly as they were.

Not tested: the Dashboard screen's message wording in a browser.
