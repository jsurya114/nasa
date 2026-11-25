# Weekly Excel upload: read the file into plain rows, without ExcelJS's cell objects (step 5)

| Field | Value |
|---|---|
| Date | 2026-11-26 |
| Author | Jayasoorya, with Claude Code (Claude Sonnet 5.5) |
| Issue / PR | none / pull request into `develop` for Jasil's review |
| Branch | `perf/weekly-upload-stream-rows` (from `develop`, which has #337) |
| Type / scope | `perf(excel)` |
| Files touched | `Backend/services/excel/readWorkbookRows.js` (new), `Backend/services/excel/workbookFromRows.js` (new), `Backend/controllers/admin/weeklyUploadsController.js`, `Backend/services/finance/gofoStatement/readStatementWorkbook.js`, `Backend/tests/readWorkbookRows.test.js` (new), `Backend/package.json` and `package-lock.json` (one line each), this entry. |
| Reserved files touched | `weeklyUploadsController` (Jasil's zone), with his written OK for the reader work in the migration thread on 2026-11-25 ("Row-by-row reader: option 1, your own small sax reader"). |

**What and why.** The biggest weekly file needed about 640 MB of Node heap with the code that ran, and 320 MB after #337, because ExcelJS builds an object for every cell (about 500 MB for one open of the Dallas file). The server allows 384 MB, so an upload of a bigger file would still run out of memory. This change reads the file into the same plain rows, but without those objects:
- `readWorkbookRows(buffer)` (new) unzips the file's parts, decodes them with a `StringDecoder`, and reads them with `saxes` into `{ sheet name: rows[][] }`: the same rows `sheetsFromWorkbook` builds from an opened ExcelJS workbook (plain values, a formula gives its saved result, rich text its text, a merged cell shows its master's value, a number in a date-formatted cell is a Date, a missing cell is a hole in the row). It runs after `assertSafeWorkbook`, as before.
- Why not ExcelJS's own streaming reader: it decodes every chunk of bytes to text on its own, so an accented letter split between two chunks is damaged (an accented letter in a real driver name came out as two replacement characters), and it ignores merged cells. This reader keeps a split letter whole (a test splits the file at every possible byte) and replicates merges.
- The weekly upload now reads the file once into those rows and uses them for pay, the assignment history (through `workbookFromRows`, a thin stand-in for an ExcelJS workbook, so `assignmentWorkbook.js` and the history store are unchanged), the claims and the statement check. `readStatementWorkbook(buffer)` (publish, preview) uses the same reader.
- If this reader cannot understand a file it throws `WorkbookReadError` and the callers fall back to ExcelJS, exactly as before (more memory), so an unusual but valid file still works.
- A file over the sheet or row limits is still read for pay and refused by the statement steps, as before (`readWorkbookRows(buffer, { limits: false })` plus `sheetsWithinLimits`).
- Not changed: pay logic, the claims parser, the history rules, every response shape.

**Dependency.** `saxes` 5.0.1 becomes a direct dependency (exact version). ExcelJS already depends on it, so the installed tree does not change (one line in `package.json`, one in `package-lock.json`).

**Database.** None. **Config.** None. **Money impact.** None intended; checked, see below.

**Proof (all made-up or local; the real files are not in the repository)**
- Cell by cell against `sheetsFromWorkbook`, on all six real weekly and statement files we have (2.9 million cells): 0 differences, including row widths, holes, dates, accents and merged cells; 0.2 to 0.5 s to read the biggest file.
- Made-up files with every kind of cell (strings with accents, symbols, emoji, line breaks and `_x000D_` escapes, numbers, booleans, dates in two date systems, formulas with number/text/boolean/error/date results, rich text, hyperlink text, empty strings, merged ranges, styled empty cells, empty rows, far columns, hidden and empty sheets, odd sheet names), read at slice sizes 1, 2, 3, 5, 7 and 64 bytes: the same rows as ExcelJS. Nine tests in `tests/readWorkbookRows.test.js`; the whole backend suite: 467 tests, 364 pass, 0 fail, 103 skipped (the database-gated ones).
- Through the real upload controller on the six real files, old code (release `57ff8c7d`) against this branch, in a transaction that is rolled back: the same stored pay rows (hash of every row), the same totals, the same claims answer, the same upload answer (only database ids differ). Upload time on a laptop, old to new: Dallas 8.7 to 5.0 s, the others 2.8 to 1.5, 4.1 to 2.5, 3.5 to 1.9, 4.8 to 2.6, July file 7.9 to 4.5.
- Memory: the reader alone reads the Dallas file with a 96 MB Node heap (64 MB fails); a whole upload through the controller finishes at a 128 MB heap (old code: 640 MB; #337: 320 MB).

**Stress test, exact production spec** (container: Amazon Linux 2023, arm64, Node 22, 2 CPUs, 1 GB, no swap; Postgres 17 with about 106,000 history rows from three earlier weeks; about 1 ms round trip to the database; each run rolled back). Made-up files: the Dallas file with its rows copied and every waybill and address made unique (1x = 35,448 rows, 2x = 70,896, 3x = 106,344, 4x = 141,792). Time is the upload, peak is the container's highest memory use.

| File | Heap | Release `57ff8c7d` (live) | #337 (`main`) | This branch |
|---|---|---|---|---|
| 1x | 384 MB | crash (out of memory) | 6.7 s, 541 MB | 5.4 s, 306 MB |
| 1x | 768 MB | 11.4 s, 876 MB | 6.3 s, 595 MB | 5.2 s, 302 MB |
| 2x | 384 MB | crash | crash | 9.9 s, 325 MB |
| 2x | 768 MB | crash (after 28 s) | 11.4 s, 828 MB | 10.5 s, 324 MB |
| 3x | 384 MB | crash | crash | 12.8 s, 422 MB |
| 3x | 768 MB | killed by the container (exit 137) | 19.3 s, 992 MB | 13.0 s, 419 MB |
| 4x | any | refused (see below) | refused | refused |

Pay rows hash and totals were the same for #337 and this branch on every file they both finished (2x and 3x included; the live code cannot finish them). Nothing here reproduces the 14 minutes the client saw: the slowest finished run is 20 s.

**The next ceiling is not memory.** The 4x file inflates to 112.7 MB and every version refuses it: `assertSafeWorkbook` allows at most 100 MB inflated (`MAX_UNCOMPRESSED_BYTES`) and the upload at most 25 MB. The 3x file (85.7 MB inflated, 106,000 rows) is the largest that passes. Raising the cap is a security decision for Jasil; it is not changed here.

**Tested.** Everything above. **Not tested:** on the real t4g.micro and RDS (the first real numbers come from the client's re-upload after the deploy); through the real HTTP endpoint (login, multer, Caddy; the controller function was called directly); a real file bigger than the Dallas week (the 2x and 3x files are made up from it); files from a generator other than the carrier's (they fall back to ExcelJS if this reader cannot read them, but a file it reads wrongly without an error would not be caught; the cell-by-cell test is the guard).

**Risks and follow-ups.** The reader is about 300 lines in the pay path; a reviewer should read it against `sheetsFromWorkbook`. Do not deploy before Jasil and Jayasoorya say go. Next: run the upload in its own process, so a failed upload can never take the site down; raise (or not) the 100 MB cap.
