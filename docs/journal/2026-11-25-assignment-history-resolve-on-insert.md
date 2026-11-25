# Weekly upload: save the assignment history once, already resolved

| Field | Value |
|---|---|
| Date | 2026-11-25 |
| Author | Jayasoorya, with Claude Code (Claude Sonnet 5.5) |
| Issue / PR | none / pull request into `develop` (not opened yet: Jasil to review first) |
| Branch | `perf/assignment-history-resolve-on-insert` (from `perf/weekly-upload-read-once`, which holds the read-once change) |
| Type / scope | `perf(excel)` |
| Files touched | `Backend/services/excel/assignmentHistory/assignmentStore.js`, this entry. |
| Reserved files touched | None on the reserved list. The weekly upload reaches this code through `recordWorkbookHistory` (issue #140). Jasil is asked first. |

**What and why.** The biggest remaining cost of a big weekly file was the assignment history (about 3.7 s of 5.8 s on a laptop for DFW). Each new fact was written, then updated a second time to link its driver and route, and every update runs the table's guard trigger. Now the insert links the driver (Delivery ID against the driver code) and the route (Region/route against the route code and its city) with the same rule, so each new fact is written once. `refreshOpenAssignments` still resolves facts stored earlier. The reported `resolved` counts stay the same: the old refresh count plus the new facts resolved at insert.

**Results (laptop, local database, rolled back, four real files, before and after).** Same history table (a fingerprint of every fact with its driver code, route code, city name and resolved flags), same imports and sightings, same answer to the admin (ids left out, they differ per run). No amounts, rows or names are written here. Upload time: DFW (35,400 rows) 6.2 s to 4.2 s, SHV 3.0 to 2.0, TYR 3.7 to 2.3, LFT 2.2 to 1.3. Together with the read-once change, DFW goes from about 9 s to about 4 s. The server still freezes about 0.5 s while ExcelJS opens the file; that is not changed here.

**Database.** No schema change, no migration. Same tables, same constraints and trigger (a new fact is inserted already resolved, which the guard allows: it only blocks changing a resolved fact). The drivers and routes lookups use the existing unique columns (`driver_code`, `route_code_in_string`, `city.job`), so a code matches at most one row, as in the old update.
**Config and dependencies.** None. **Money impact.** None: the history is evidence for claims and never feeds pay; `weeklycount` is not touched.

**Tested.** The four real files above (identical history and answer, before and after). The 35 database-backed history tests (store, flow, void race) pass on the new code and on the old code, on an empty scratch copy of the local schema (the scratch database is dropped). The whole backend suite: 355 passed, 0 failed, 103 skipped (database tests that need the flags). **Not tested:** on the real server and the real database (RDS may behave differently); unresolved drivers and routes only through those 35 tests (the four real files resolve every row in my local data).

**Risks and follow-ups.** Do not deploy before the recovery drill and the old-server deletion (Jasil's order). The read-once change (step 1) and this one are separate pull requests. Remaining time is the history insert (about 1 s) and the file read; the next step would be the upload worker.
