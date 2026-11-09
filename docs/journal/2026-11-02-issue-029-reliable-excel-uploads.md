# Make Excel uploads fail safely and stop colliding (issue #29)

- **Date:** 2026-11-02
- **Author:** Jasil (with Claude Code)
- **Issue / PR:** #29 / see the pull request for this branch
- **Branch:** `fix/reliable-excel-uploads`. Built on top of `fix/limit-actions-to-admins-cities` (#26), which changes the same controllers. Merge #26 first (its own base commits #116 and #117 come with it).
- **Type and scope:** fix(excel)
- **Files touched:** new `Backend/services/admin/uploadSafety.js`; `Backend/controllers/admin/fileUploadsController.js`, `weeklyUploadsController.js`, `dashboardController.js`; `Backend/services/admin/weeklyExcelQueries.js`. All reserved files, Jasil's zone.

**What and why.** Measured on the old code with the same test files (fake data), four things went wrong:

1. A weekly file whose dates the system could not read was reported as **successful** and replaced the staged data with nothing.
2. A database error part-way through the weekly upload left the staging table **gone**: the old table was dropped before the transaction started.
3. Two weekly uploads at the same time ended as a **mix of both files**. Two daily uploads at the same time failed with "duplicate table" errors.
4. Bad files gave the same message ("Internal server error") whatever the cause.

What changed:

- **One upload at a time.** The daily upload, the weekly upload and "add staged weekly data to the dashboard" take one database lock. The second one waits (up to 60 seconds) and then runs; after that it answers "Another upload is still running" (409).
- **All-or-nothing.** The weekly upload now drops, creates and fills its staging table in one transaction. If anything fails, the previous staged data is still there. "Add staged data to dashboard" now clears the staging table in the same transaction as its insert, and the city check happens inside it.
- **Refuse bad files before touching anything**, with a specific message (the screens already show the server's `message`):
  - not a readable spreadsheet; the sheet is missing; a required column is missing (weekly: any of Delivery ID, Signing Time, Stop Point Details; daily: Route, Sequence, Status);
  - a weekly file where **no row** is usable (the message says what each row needs);
  - an impossible `uploadDate` for the daily upload.
- **Logs name the action and counts only** (rows read, processed, skipped, inserted). Per-row error lines and the raw error text in 500 responses are gone, so a database message can no longer reach the browser.

**Database.** None. No schema, trigger or data change. The lock is a session-level advisory lock held only for the length of the transaction.

**Config and dependencies.** None.

**Money impact.** None. The counting, matching and pay logic is untouched. Same-file results are identical (see tests).

**Behaviour changes to know about.**
- A weekly file with no usable rows used to "succeed" with 0 rows; it is now refused (400) and the staged data is kept.
- A daily file with the right sheet but a missing Route, Sequence or Status column is now a clear 400 instead of a 500.
- A daily file with no rows at all is still processed as before. Tested: after a good upload it changes nothing; on a day with no earlier upload it marks the day's packages as not scanned.
- If an upload is waiting on another for over a minute, it answers 409 instead of waiting forever.

**Tested.** The same scenarios were run on the old code (`develop`) and on this branch, using the real controllers against a throwaway local database (fake data, reconstructed schema):

| Scenario | Old code | This branch |
|---|---|---|
| Weekly file, every date unreadable, 4 rows already staged | 200 "success", staged data **wiped** (0 rows) | 400 with reason, staged data kept (1 row, 4 packages) |
| Weekly: not a spreadsheet / sheet missing / column missing | 500 "Internal server error" | 400, each with its own message; staged data kept |
| Weekly: database error part-way (route text too long) | 500, staged data **lost** | 500 "Nothing was changed", staged data kept |
| Daily: Status column missing / impossible date | 500 "Error occurred..." | 400 with reason |
| Daily: not a spreadsheet | 400 | 400 (same) |
| Two weekly uploads at once (4 rows R1 + 6 rows R2) | both 200, staged = **mix** (2 rows, 10 packages) | both 200, staged = exactly one file (1 row, 6 packages) |
| Two daily + two weekly at once | 500, 200, 500, 200 ("duplicate table", "relation does not exist") | 200, 200, 200, 200 |
| Add staged data to dashboard | 200, staging cleared | 200, staging cleared in the same transaction |

The earlier checks were re-run on this branch and still pass: the 33 city-limit checks (#26), the paid-payment guard and the date checks (#24).

**Not tested.** A real SpeedX or GOFO file, the screens in a browser, the real database and triggers. The lock-wait timeout path (a held lock for over 60 seconds) was not exercised; its error mapping is a few lines.

**Risks and follow-ups.**
- The lock serializes uploads across all admins. Normal use is a handful of uploads a day, so waiting should be short.
- The "no usable rows" message tells the admin the expected date format (`MM/DD/YYYY HH:mm:ss`). If GOFO ever changes it, uploads will now fail loudly instead of silently producing nothing.
- Still open (#24): after a permitted daily upload, the follow-up classification steps run over every unclassified delivery in all cities.
- Still open (#28): upload speed. Not touched here.
