# One GOFO upload: the weekly workbook is also the carrier statement

- Date: 9 November 2026
- Author: Jayasoorya with Claude Code, at Jasil's request
- Issue: #252; PR: see the pull request for branch `feat/gofo-single-upload`
- Type and scope: feat(excel), backend, database, frontend
- Files touched, reserved ones flagged for Jasil: **`weeklyUploadsController.js`** (reserved, one stage-and-check call added) and **`dashboardController.js`** (Jasil's zone; the weekly add now settles the revenue after it commits). No change to `weeklyExcelQueries`, `dashboardQueries`, `fileUploadsController` (the daily upload).

## What and why

The admin already uploads the full GOFO workbook under File Upload -> Weekly Upload. That same file is the carrier's statement, so it is now used for driver work and claims **and** for company revenue. Nobody chooses it twice, and the separate Statements tab and upload are gone.

1. **Upload** (unchanged pay path first): the file is staged as before, with assignment history and claims. In the same transaction, in a savepoint, the file is saved as an *import* (`carrier_statement_imports`, with the file's sha256) and becomes the import tied to the staged data. After the upload committed, the statement in the file is checked read-only (`previewStatement`, the existing reconciliation and matching). The answer carries `revenue`: a state, a message and reasons.
2. **Weekly add** (the existing "add to dashboard"): after it committed, the import is settled. An owner's import is published by the existing `publishStatement` on the saved bytes, tied to the import (`carrier_statements.source_import_id`). Result: "Revenue updated", or "Already imported" when the same statement already stands.
3. **Needs a person -> "Revenue needs review"**, never a failed upload: a failed check (reasons listed), a correction of a statement that already stands, an older version, a city admin's upload (only the owner publishes company revenue, as before), or a publish that did not finish. The prior verified revenue stays in place and the weekly workflow works exactly as before.
4. **Owner review without re-uploading**: the saved file is kept while the import is open. GOFO import history (the old Statements page, now without an upload form) lists "Waiting for your review" with Publish / Check again, a separate confirmation for a correction, and Dismiss with a reason. Publishing re-checks the saved file, so a stale or changed situation is refused, not guessed.
5. **Corrections** never replace verified revenue silently: `publishStatement` has a new `allowCorrection` option; the weekly add passes `false`, the owner's confirmation passes `true`. Versions, supersession, voids and audit events are the existing ones.
6. **Insights** keeps showing company revenue and margin and gets a small link to the GOFO import history (the whole page is super admin only). The top-level Statements tab and `StatementUpload` are removed; the statement history, unallocated view, CSV, void and rematch stay.

Retry and duplicate safety: the same file again is `already_imported` (statement fingerprint), the weekly rows are not duplicated (existing rule), and a second settle finds the import already settled (row lock). If a newer upload replaced the staged data before the add, the older import is never published ("a newer weekly upload replaced it"). Unmatched charges stay in the city total as unallocated revenue (existing reporting).

What stays the same: weekly delivery counts, driver pay, claims and exemptions, pay runs, the daily SpeedX upload (its controller is untouched and a test checks that its figures and source do not change), and the existing statement routes (`/preview` and `/publish` are still there for API use; only their screen is gone).

## Database

New: `Backend/migrations/2026-11-09-issue-252-weekly-upload-revenue.sql` (rollback: `.rollback.sql`). Additive, safe to run twice, in one transaction, on a copy first, after a backup, after `2026-11-08-issue-252-carrier-statements.sql`:

- table `carrier_statement_imports` (hash, label, who, status, reason, review JSON, the saved file, current/applied markers; a delete guard, one current import at a time, the file only while the import is open),
- column `carrier_statements.source_import_id` (plain id) and the statement guard now keeps it fixed.

The rollback drops the imports table, restores the previous guard and drops the column; statements and audit events are untouched. Without the migration the weekly upload works exactly as before and the answer says "Revenue import is not set up in the database yet."

## Config and dependencies

None.

## Money impact

None to pay, claims, pay runs or daily SpeedX. Company revenue is published through the same checked statement path as before, now from the weekly file, and only for an owner. Real workbooks, one upload each through the real controllers in a rolled-back local transaction: LFT 28 Sep-4 Oct, SHV 19-25 Oct, SHV 28 Sep-4 Oct and TYR 28 Sep-4 Oct each reconcile and reach Insights with exactly the reconciled delivery revenue (19,317.04; 26,347.05; 25,754.35; 31,245.92), a repeat upload says "Already imported". The DFW 19-25 Oct workbook fails its own check ("1 delivery line is signed outside Week 43-2026"): its weekly pay data was still staged and added (249 rows), no revenue was published, and the answer was "Revenue needs review" with that reason.

## Tested

- `gofoWeeklyUpload.test.js` (database, rolled back, fixture workbook): another city's admin refused with nothing saved; a city admin uploads and adds the data, pay works, no company figure reaches them, revenue waits; the owner publishes the saved import without choosing the file again and Insights shows the reconciled totals; the same file again is "Already imported" and nothing doubles; a corrected week waits, needs its confirmation, and the history and audit events keep every step; a failed check leaves the weekly flow and the verified revenue in place, re-checks on request, can be dismissed; unmatched carrier money stays in the city total; the daily SpeedX figures and source are unchanged.
- `gofoWeeklyImport.test.js` (no database, runs in CI): older database without the table, a city admin sees no company figure, the owner does, a replaced or settled import is never published again, problems are answered not thrown.
- `gofoStatementApi.test.js`: the three new owner routes, statuses, trimmed reason, only a real `true` confirms a correction, and 401/403 for everyone else.
- Frontend: import review (publish without a file chooser, correction confirmation, check again, dismiss with a reason), no file chooser on the history page, the revenue messages in the upload flow, no Statements tab, the Insights link. Whole suite: 57 files, 505 tests; build ok.
- Backend whole suite with database tests: 649 run, the same 10 failures as on `develop` (claims store, Everee payment status and submit, pay runs on a copy that holds real sandbox payments); CI-style run: 255 pass, 0 fail.

Not tested: two real connections racing an upload against a weekly add (the row lock and the "no longer current" rule are exercised by fakes and by the single-connection test); a real browser or phone; a very large workbook beyond the four above (the upload now also reads the file for its statement: about 3 to 9 seconds on the real files, once at upload and once more when the owner publishes).

## Risks and follow-ups

- The workbook is kept in the database only while an import is open (needs review) and is emptied once it is published, found already imported, replaced or dismissed. It holds courier names, so the table is for the owner's review only (no screen shows it) and should be covered by the normal database backup rules.
- A city admin's file is never published without an owner. If the owners want city admins to publish their own city's revenue, that is a permission decision for them, not part of this change.
- The statement routes `/preview` and `/publish` still exist for the owner (API only); remove them in a later PR if the owners want the single path enforced.
- Run the migration on the shared database (backup first) before this is deployed; until then the feature is silent and the upload behaves as before.

## Review hardening (automated security review of the first push)

The weekly staging table is shared, so an owner who adds staged weekly data could have published a revenue statement from a file a *city admin* uploaded, without ever reviewing it. Automatic publishing now needs both: the import was uploaded by an owner (`uploaded_by_role = 'superadmin'`) **and** an owner adds the data. A city admin's file is never published as a side effect of someone else's weekly add: it waits as "Revenue needs review" (reason: uploaded by a city admin) and the owner publishes it from the import history. Tests: unit (owner adds a city admin's file) and database (owner adds a city admin's staged data, nothing published, both saved imports wait; publishing the same statement twice answers "already imported"). The city check the review also suggested already exists: a city admin's upload is refused unless every route belongs to their cities (before anything is saved), and the statement's city comes from those same routes.
