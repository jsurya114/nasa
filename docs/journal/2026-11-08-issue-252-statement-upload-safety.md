# Carrier statement upload: refuse zip bombs (security review finding on PR #255)

- Date: 8 November 2026
- Author: Jayasoorya with Claude Code
- Issue: #252; branch `feat/gofo-statement-api` (PR #255)
- Type and scope: feat(excel). New: `workbookSafety.js`, `tests/gofoStatementSafety.test.js`. Changed: `readStatementWorkbook.js` (a file from PR #253).

## What and why

An automated security review of the upload route noted that an `.xlsx` file is a zip, and a small zip can inflate to gigabytes, exhausting memory when the workbook is opened.
Before the workbook is opened, the zip's own directory is now read (nothing is inflated) and a file is refused when it declares more than 100 parts, more than 200 MB of
inflated data, a compression ratio above 100, zip64, or a damaged directory. A real statement is about 15 to 20 MB inflated at a ratio near 11, so it is nowhere near the limits.
After opening, a workbook with more than 20 sheets or a sheet with more than 200,000 rows is refused. The upload itself stays limited to 25 MB, one file, in memory.

Follow-up (second automated review): checking only the sizes a zip DECLARES can be bypassed by a directory that understates a part. Every part is therefore really inflated
in the check, with a hard cap (100 MB in total, `inflateRawSync` with `maxOutputLength`), and must come out at exactly the size the directory declared; a part with an unsupported
compression method, a damaged local header or a different real size is refused. The cap on declared data was lowered from 200 MB to 100 MB (a real statement is about 20 MB).
The opened workbook is still capped (20 sheets, 200,000 rows) and the upload is limited to 25 MB, one file, and reachable only by the super admin.

## Database, config, dependencies, money impact

None.

## Tested

`tests/gofoStatementSafety.test.js` (5 tests, made-up files, patched zip directories and a hand-built zip whose directory lies about a 120 MB part): a normal workbook is accepted; a part declaring about 4 GB, an absurd ratio, 101 parts, zip64,
plain text, a truncated zip, a hostile file passed to the reader, a part that really inflates to 120 MB while declaring a few bytes, and a part one byte off its declared size are all refused. The existing statement tests and the database test still pass, and the two real statements
still reconcile.
