# GOFO statement parser and reconciliation preview (stage 1)

- Date: 7 November 2026
- Author: Jayasoorya with Claude Code
- Issue: #252; branch `feat/gofo-statement-parser`
- Type and scope: feat, new files only under `Backend/services/finance/gofoStatement/`, one script and one test file. No reserved file (`weeklyUploadsController`,
  `weeklyExcelQueries`, `dashboardQueries`) and no existing file is touched. Requested by Jasil in Slack on 7 Nov 2026.

## What and why

Weekly GOFO company revenue is estimated from configured company rates, but the carrier's statement holds the billed amounts. This first stage only READS and CHECKS
a statement; nothing is stored, no route or screen changes, and no figure is published.

- `statementMoney.js`: exact cents (a blank cell is missing, a 0 is a real zero, more than two decimals or text is refused) and the carrier's own date format kept as the
  carrier's day, with no time zone shift.
- `parseStatement.js`: reads the nine sheets into plain records with their source sheet and row; fleet, currency, bill number and billing period come from the DSP Summary.
  A bad cell is recorded as an issue (sheet, row, field) and the line is left out. Prepayments and withdrawal fees are read apart and never added to delivery revenue.
  A fingerprint (the same for the same statement in any row order, different for a corrected one) is there for the idempotent re-upload of stage 2.
- `reconcileStatement.js`: the detail lines plus offsets are the source of truth; the DSP Summary, Driver Summary and Driver Daily Summary are controls that are compared and
  never added. Delivery revenue = detail lines + offsets; settlement payable = delivery revenue + claims + ledger adjustments. Any issue or one cent of difference gives
  `rejected`. The carrier's delivery count (which includes offset tickets) is only checked as a control; NASA's own completed-delivery definition is not changed.
- `Backend/scripts/gofoStatementPreview.js --file <xlsx>`: prints status, amounts, counts and failed checks, never a driver name. Read-only.

## Database, config, dependencies

None. `exceljs` is already a dependency.

## Money impact

None. Nothing reads these files yet and no payroll, pay run, rate or Dashboard code changed.

## Tested

- `tests/gofoStatement.test.js` (10 tests, synthetic fixture with made-up couriers and amounts): exact cents, blank versus zero, dates, reconciliation to the cent, source rows,
  every control one cent off, bad amount/day/ID/missing sheet/column, prepayments kept apart, fingerprint, and a real `.xlsx` built in memory.
- By hand with the preview script on two real carrier statements (Lafayette and Shreveport, one week each): both reconcile with no issue. Their amounts are not recorded here
  because this repository is public.

Not tested: the 19-25 October Lafayette workbook Jasil described (it was not on this machine); the Insights and MCP numbers; any upload through the screen.

## Risks and follow-ups

Stage 2 (storage, matching, audit trail, upload route) edits Jasil's reserved files and needs his go-ahead on the design. Open question for him: the exact tolerance for the
four delivery lines without a route and the six offsets without a pay group (stage 2 keeps them visible as unallocated).
