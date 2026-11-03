# Record assignment history from the weekly upload and from older reports (issue #140, part 2)

| Field | Value |
|---|---|
| Date | 2026-11-03 |
| Author | Jasil (with Claude Code) |
| Issue / PR | `#140` / see the pull request for this branch |
| Branch | `feat/gofo-history-import`, stacked on `feat/gofo-assignment-history` (part 1) |
| Type / scope | `feat(excel)` |
| Files touched | New: `Backend/services/excel/assignmentHistory/recordWorkbookHistory.js`, `Backend/controllers/admin/assignmentHistoryController.js`, `Backend/routes/assignmentHistoryRoutes.js`, `Backend/tests/assignmentHistoryFlow.test.js`. Edited: `Backend/controllers/admin/weeklyUploadsController.js` (4 lines in the live upload), `Backend/app.js` (one import and one mount). |
| Reserved files touched | `weeklyUploadsController.js` (Jasil's zone, own change). `app.js` is Jayasoorya's area: the change is one import and one mount of a new router before `/admin`, the same shape as the `/admin/payroll` mount in #149. |

**What and why.** Part 1 added the tables and the lookup. This part fills them.

- **The weekly GOFO upload now also keeps assignment history.** After it has staged the pay data, in the same transaction and under the same upload lock, it records both sheets' evidence. The pay code path is not changed: nothing about the staging rows, the counts or the dashboard insert is edited.
- **The history is written inside a savepoint.** If it cannot be saved (for example the migration has not been run on that database yet), the savepoint is rolled back and the pay upload carries on exactly as before. The response says `assignmentHistory: { saved: false, reason }` and the server logs it. So the backend can be deployed before the migration without breaking the weekly upload; the history simply is not kept until the migration is run.
- **The response gains one key**, `data.assignmentHistory`: whether it was saved, the import id, how many facts were new / already known / left out for a city admin, facts brought back from a voided report (`reassertedAfterVoid`), the number of unreadable rows with up to 10 `{ sheet, row, reason }` entries (never cell values), and per-sheet row counts. Existing keys are unchanged.
- **Older reports have their own door.** `POST /admin/assignment-history/import` (any admin; multipart field `file`) reads a report and keeps its evidence **without touching the weekly staging table or any pay table**, so an older report can be uploaded to resolve old claims without disturbing the current week. It refuses a file that cannot be read or has neither sheet (400), and answers 503 "not set up" if the tables are missing.
- **Review and correction.** `GET /admin/assignment-history/conflicts` (super admin) lists waybills whose standing history names more than one Delivery ID, driver or city. `POST /admin/assignment-history/imports/:importId/void` (super admin, a reason is required) marks a wrong import as void; nothing is deleted.
- **City admins** keep only the routes of their own cities in both entry points; the rest is counted as `leftOut`, and no file that uploaded before is refused now.
- **Same file, any name, any time:** the file's hash is checked, so a renamed copy records nothing new, and two imports at the same moment wait for each other.

**Not wired yet (waiting on #148).** After new history arrives, the claims that were unresolved should be matched again: `rematchOpenClaims(client, candidateFinderFor(client))`. #148 is not merged, so this part does not import it. When it merges, the call goes in `recordWorkbookHistory.js` right after `recordReport`, inside the same transaction (a one-line change plus its test). Until then a claim is rematched whenever #141's own rematch runs.

**Database.** None in this part (the tables are part 1). The savepoint means the weekly upload works with or without them.

**Config and dependencies.** None.

**Money impact.** None, measured. The real weekly upload and the real "add staged data to the dashboard" handlers were run against a private scratch copy of a snapshot of the production database, once with the code from before this change and once with the code from this branch, on two real GOFO reports (Lafayette and Tyler, 28 Sep to 4 Oct, the week deleted in both copies so the import has rows to insert):

For both reports, the staged rows (count, deliveries, first stops, double stops), the dashboard rows inserted, the payment rows, the driver pay, company earnings and insurance totals, and a hash over every staged row and every payment row, field by field, were **identical to the cent** before and after. The amounts are not written here because they come from real data.

(The hashes cover every staged row and every payment row, field by field.) The STOP Point Details counting is untouched: only the value `1` is a first stop and every other value, including those above 2, counts as it did.

**Tested.**

- 9 handler-level tests (`assignmentHistoryFlow.test.js`, `ASSIGNMENT_TEST_DB=1`) using the real controllers on a scratch copy, inside one transaction that is always rolled back (the handlers' own BEGIN / COMMIT become savepoints): a weekly upload stages exactly what it did before and reports its history; a renamed copy; a re-saved copy with the same facts; an older report that leaves staging, dashboard and payments untouched; a city admin; unreadable files and a file without the sheets; listing conflicts and voiding once with a reason; and a database without the tables (the pay upload is the same, the answer says not saved; the history-only import answers 503).
- 2 mutation checks, each failing 2 tests: the city scope removed, and a history failure aborting the pay upload.
- Three simultaneous imports of the same 16,097-fact report, on the scratch copy: one recorded it, two found it already there, the fact count went up by exactly 16,097, and the payment totals did not change.
- Part 1's 16 + 20 tests, and the whole backend suite with the database tests skipped (as CI runs it).

**Not tested.** The screens (the upload page shows the same messages as before and ignores the new key); a DFW GOFO report; a real browser upload; production data; the rematch call (see above).

**Risks and follow-ups.**

- The upload page does not show `assignmentHistory` yet. A short line ("history saved" / "history not saved: reason") belongs in the upload screen and can follow.
- The history-only import is open to any admin, like the weekly upload. If only a super admin should import older reports, it is a one-word change in `routes/assignmentHistoryRoutes.js`.
- Part 1's follow-ups still stand: driver codes have no history, and a city admin's file can name any driver (a conflict is kept for review, not silently settled).

**Review round 1 (Jayasoorya, PR #157).** The void endpoint now checks out one client and wraps the whole void in an explicit transaction, because the store's void takes a transaction lock (see part 1's journal). The store fixes (lock shared with imports, frozen void actor, concurrent test) come in with the merge of part 1.
