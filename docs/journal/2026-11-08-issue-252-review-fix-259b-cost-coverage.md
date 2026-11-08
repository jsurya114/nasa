# Second review fix for PR #259: margin says how far its driver cost is known

- Date: 8 November 2026
- Author: Jayasoorya with Claude Code
- Issue: #252; PR #259; branch `feat/gofo-statement-economics`
- Type and scope: fix, `statementEconomics.js`, `statementCsv.js` and their tests. No reserved file.

## What and why

Jasil's re-review found that a published statement presented missing driver pay as zero cost: a matched record with no driver payment, or a statement published before any NASA work existed,
showed $0.00 driver earnings and the whole revenue as margin, as if complete.

Each statement now carries `marginStatus` and its reasons:

- `complete`: every carrier line group is matched to NASA work and every covered record has its driver earnings.
- `provisional`: some cost is missing (a covered record has no driver earnings yet, or carrier line groups matched no NASA work). The figures are kept and the reasons say what is missing and how much.
- `unavailable`: no NASA work is recorded against the statement at all, or it is an inactive version. Driver earnings, delivery margin, contribution and the insurance figures are null, never zero.

The carrier's own figures (delivery revenue, claims, adjustments, settlement payable, matched and unallocated revenue) stay visible in every case. The CSV has a new "Margin status" column after
"Delivery margin", and unavailable figures are empty cells there.

## Database, config, dependencies

None.

## Money impact

None to stored amounts. Reports that showed an unqualified margin now say when it is provisional or unavailable.

## Tested

- `tests/statementEconomics.test.js` on a clean local copy of the database (PAYROLL_TEST_DB=1), as Jasil described: a matched record with a NULL driver payment gives "provisional" with the reason
  and the carrier's revenue and settlement unchanged, and the CSV says so; publishing the statement before any NASA work exists gives "unavailable" with empty driver earnings, margin and
  contribution and the carrier's revenue and settlement intact. The earlier cases (complete, replaced and voided versions) still pass, and `gofoStatementCsv.test.js` with the new column.

Not tested: how this reads on the two real statements in the screen (each has a few carrier lines that match no NASA work, so they would show "provisional"; that is the honest answer for them).
