# Statement economics, owner-only CSV export and a reporting-only backfill (stage 5)

- Date: 8 November 2026
- Author: Jayasoorya with Claude Code
- Issue: #252; branch `feat/gofo-statement-economics` (stacked on `feat/gofo-retire-company-prices`, PR #258, on #257, #256, #255, #254, #253)
- Type and scope: feat(excel). New files except `router.js` and `statementService.js` (the owner-only routes from PR #255). No reserved file.

## What and why

- **Economics per statement** (`statementEconomics.js`, shown in `GET /admin/finance/gofo-statements` as `economics`): delivery revenue, driver earnings, **delivery margin before carrier claims and
  ledger adjustments**, carrier claims, ledger adjustments, **contribution** (margin + claims + adjustments), **GOFO settlement payable**, insurance withheld and **driver earnings after insurance**,
  matched and unallocated revenue, NASA's own delivery count beside the carrier's (which includes offset tickets), and the records with no billed fee. They come from the SAME reporting view as
  Insights and the Dashboard, so they cannot differ. Net driver payouts are shown apart from gross; only insurance is subtracted here (claim recoveries and advances are settled in Payroll).
- **Owner-only CSV exports** (`GET .../export.csv`, `GET .../:id/unallocated.csv`): the statements with their economics, and a statement's unallocated lines with the reason. Same super-admin gate,
  `no-store`, `attachment`, `nosniff`. No driver names. Text that came from a statement file (bill number, city, route) is prefixed so it cannot run as a spreadsheet formula.
- **Backfill** (`scripts/gofoStatementBackfill.js --dir <folder> [--commit] [--admin <id>]`): reads every `.xlsx` in a folder, oldest billing week first, reconciles and matches each one, and
  prints what it would do (a dry run by default). With `--commit` it stores them as origin `backfill` through the same publish used by the upload. Reporting only: it writes the carrier statement
  tables and nothing in payroll, pay runs, rates or the Dashboard. A statement that does not reconcile is reported and skipped; an earlier version of a week is reported, not re-published.
  Historical periods without a verified statement keep their old figures and are labelled **estimated** by the reporting definition (PR #257).

## Database, config, dependencies

None.

## Money impact

None to pay. These are reports over stored figures. Re-running the backfill is a no-op for statements already stored.

## Tested

- `tests/statementEconomics.test.js` (needs `PAYROLL_TEST_DB=1`, rolled back, made-up data): revenue 4.91, driver earnings 6.50, margin -1.59, claims -0.70, adjustments -2.00, contribution -4.29, settlement
  2.21, insurance 1.92, net of insurance 4.58, NASA 6 deliveries against the carrier's 5, one record with no billed fee; the CSV has the exact columns and values and no driver name.
- `tests/gofoStatementCsv.test.js` (formula-injection prefix, quoting, CRLF, column counts), `tests/gofoStatementApi.test.js` (the CSV routes: owner only, download headers, bad id, not found),
  `tests/gofoStatementBackfill.test.js` (order, dry run stores nothing, rejected skipped, commit publishes oldest first with the file name).
- By hand on a copy of the local database with two real statements (Lafayette 28 Sep to 4 Oct and Shreveport 19 to 25 Oct): the dry run lists both as would-publish; committing stores both with
  version 1; the list shows their economics; NASA's delivery count equals the number of detail lines on each (12,454 and 16,151); the CSV has one line each. The amounts are not recorded here because this
  repository is public.

Not tested: Jasil's 19 to 25 October Lafayette workbook (not on this machine), so his provisional figures are not yet matched to the cent; the screen (next part).

## Risks and follow-ups

Backfilled weeks become protected from Calculate Payment (PR #256) and use the carrier's revenue in reports; run the dry run first and check the matched and unallocated amounts.
