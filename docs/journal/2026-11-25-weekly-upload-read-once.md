# Weekly Excel upload: open the workbook once (step 1, branch only)

| Field | Value |
|---|---|
| Date | 2026-11-25 |
| Author | Jayasoorya, with Claude Code (Claude Sonnet 5.5) |
| Issue / PR | none / pull request into `develop` after Thursday's server numbers (see the PR) |
| Branch | `perf/weekly-upload-read-once` (from `develop`) |
| Type / scope | `perf(excel)` |
| Files touched | `Backend/controllers/admin/weeklyUploadsController.js`, `Backend/services/finance/gofoStatement/` (`readStatementWorkbook.js`, `publishStatement.js`, `weeklyImport.js`), `Backend/services/payroll/claims/recordWorkbookClaims.js`, `Backend/tests/weeklyUploadReadOnce.test.js` (new), this entry. |
| Reserved files touched | `weeklyUploadsController` (Jasil's zone), with his written OK in the migration thread on 2026-11-25 ("I'm OK with you editing `weeklyUploadsController` and the read code for this"). |

**What and why.** The largest weekly file (the Dallas one, about 35,000 delivery lines) was the slowest upload. One upload read the same file over and over: ExcelJS opened the whole workbook in the controller, SheetJS read the big "Details of Delivery Fees" sheet again to get the driver names for the claims, and after the commit the statement check opened the whole workbook with ExcelJS a second time. While the statement check ran, the controller's first copy was still in memory. This change (Jasil's step 1, with his conditions):
- `assertSafeWorkbook` now runs on the bytes **before** anything opens the file. Before, it ran only inside the statement check, after the controller had already opened the workbook. A file it refuses is now refused at the start ("Nothing was changed"), where before the pay data was saved and only the revenue check said "unavailable". Every real weekly file we have passes it (about 10 to 25 ms).
- The workbook is opened once. A new `sheetsFromWorkbook(workbook)` builds the same `{ sheet: rows[][] }` as `readStatementWorkbook`, with the same sheet and row limits. `readStatementWorkbook(buffer)` is now the safety check, the open, and that function, so the buffer entry point (used by `publishStatement`, the preview and the scripts) is unchanged.
- After the assignment history is saved, the controller turns its workbook into those rows once and lets go of the workbook (and of the sheet it held), then gives the rows to the claims step (driver names from `parseFeeNameRows` instead of a second SheetJS read of the big sheet) and to `reviewImport` -> `previewStatement` -> `readAndReconcile` (no second open). If building the rows fails for any reason, those steps read the file from its bytes exactly as before.
- Not changed: pay logic, the claims parser, the small Claims Detail read (SheetJS, about 0.1 s), claims inside the transaction, the statement check after `COMMIT`, every response shape.

**Why this is now more than a speed-up (added 2026-11-25, evening).** The production service runs Node with `--max-old-space-size=384` (the t4g.micro default in `docs/infra/terraform`). The largest file needs about 640 MB with the code that runs today, so its upload runs out of memory: on the same file, locally, with a 384 MB limit the release code stops with "JavaScript heap out of memory" after about 9 s, and with this change it finishes (about 6 s, same pay rows and claims). The production log shows two "JavaScript heap out of memory" crashes of the backend since the cutover (24 Nov 22:10 and 25 Nov 09:34 UTC), each followed by about 5 minutes before the service restarted. The crash times match a large upload; I did not prove that from the server. With a 384 MB limit this change leaves a margin of about 20 % over the smallest limit it needs (320 MB), so a larger file could still fail: a bigger heap or instance, or the upload worker, is the next step.

**Database.** None. **Config and dependencies.** None. **Money impact.** None intended; checked, see below.

**Before and after, on the same real files** (local copy of the database, the real controller, inside a transaction that is always rolled back; the test city, routes and drivers were created inside it so claims, matching and the statement check all ran). For all five real weekly files we have:
- weekly pay rows stored: identical (same rows, same totals, to the cent), compared by a hash of every stored row and by the counts;
- claims: same answer (stored, matched `chargeable`/`exempt`, problems, in-file count);
- statement check: same state and the same answer, field by field (only database ids differ between two runs);
- workbook opens per upload 2 -> 1, SheetJS reads 4 -> 2; time on my laptop 8.7 -> 5.5 s (largest file), and 35 to 60 % less on the others;
- memory (measured again at the end of the day with nothing else in the process, which gives lower and more accurate numbers than the first run): the smallest Node heap limit the largest file's upload completes in went from about 640 MB to about 320 MB (576 fails before, 256 fails after).
The actual amounts are not in this repository (it is public); they were compared and match.

**Tested.** `node --test` for the backend: 458 tests, 355 pass, 0 fail, 103 skipped (the database-gated ones); four new tests in `tests/weeklyUploadReadOnce.test.js` (rows from an open workbook equal the rows read from the file; the sheet limit still applies; the statement check gives the same answer from the rows and never opens the bytes; driver names from the rows equal the SheetJS read, for text and numeric Delivery IDs). **Not tested:** on the production server (numbers come from Thursday's upload and, after deploy, the next one); the existing database-gated end-to-end test `gofoWeeklyUpload.test.js` does not pass on my local database even without this change (leftover data), so it was not usable as a check; the row limit (200,000) with a real file that large; the "opens the workbook once" test of a whole upload (Jasil's step 3).

**Risks and follow-ups.** **Do not deploy until the recovery drill and the old-server deletion are done** (Jasil's condition: the drill tests the code that runs today). Next: step 2 (answer the admin before the statement check finishes), then the "opens once" test and the checklist line. A bigger instance only if the numbers still say so.
