# Review fix for PR #259: a superseded version no longer shows zero driver costs

- Date: 8 November 2026
- Author: Jayasoorya with Claude Code
- Issue: #252; PR #259; branch `feat/gofo-statement-economics`
- Type and scope: fix, `Backend/services/finance/gofoStatement/statementEconomics.js` and its test. No reserved file.

## What and why

Jasil's review found that after a correction, the superseded version showed $0 driver earnings and zero NASA records, so its whole revenue looked like margin. The economics were
worked out from the shared reporting view, which only assigns records to the statement that stands (published), so an inactive version had nothing to count and silently reported zero.

An inactive (superseded or voided) version now returns explicitly unavailable economics instead:

- Driver earnings, delivery margin, contribution, insurance withheld, driver earnings after insurance and the NASA record and delivery counts are `null`, with
  `economicsAvailable: false` and a plain reason. They are never zero and never borrowed from the replacing version.
- What the carrier itself stated on that version is kept: delivery revenue, claims, ledger adjustments, settlement payable, matched and unallocated revenue, the carrier's count.
- In the CSV the unavailable fields are empty cells.

The alternative, preserving historical cost attribution, would need the driver amounts to be snapshotted when a version is replaced (a schema change); this PR does not do that.

## Database, config, dependencies

None.

## Money impact

None to any live figure. Only history rows change: they show "not available" where they showed a misleading zero.

## Tested

- `tests/statementEconomics.test.js` on a clean local copy of the database (PAYROLL_TEST_DB=1): after a correction, version 2 shows revenue, driver earnings and margin
  (4.91 to 5.01 revenue, 6.50 driver earnings, -1.49 margin), version 1 has every NASA-side field null and the carrier's figures intact, its CSV row has empty cells, and a voided
  version has none either.

Not tested: the screen (the list shows these figures; the screen change is in #260 and is made there).
