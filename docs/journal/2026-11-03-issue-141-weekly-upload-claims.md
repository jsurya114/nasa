# Store the Claims Detail sheet in the weekly upload (issue #141, upload wiring)

| Field | Value |
|---|---|
| Date | 2026-11-03 |
| Author | Jasil (with Claude Code) |
| Issue / PR | `#141` / see the pull request for this branch |
| Branch | `feat/weekly-upload-claims` |
| Type / scope | `feat(excel)` |
| Files touched | New: `Backend/services/payroll/claims/recordWorkbookClaims.js`, `Backend/tests/weeklyClaimsFlow.test.js`. Edited: `Backend/controllers/admin/weeklyUploadsController.js` (import, one call, `claims` in the answer), `Backend/services/excel/assignmentHistory/recordWorkbookHistory.js` (also returns the report's route codes), `Backend/controllers/admin/assignmentHistoryController.js` (drops that field from its answer). |
| Reserved files touched | The upload files are in the Excel zone (Jasil). The new file sits in the payroll claims folder (Jayasoorya) and only calls his `parseClaimsWorkbook`, `importClaims` and `rematchAllOpenClaims`. |

**What and why.** The claim parser and store (#147, #148) were merged but the weekly upload never called them, so a Claims Detail sheet was ignored. Now, in the same transaction and in this order: save the waybill history, parse the claims sheet, store the claims, then match this upload's claims against the history. The answer gains `claims`:

`found`, `stored`, `inFile`, `inserted`, `duplicates`, `amended`, `held`, `matched { chargeable, exempt }`, `waiting { unresolved, ambiguous }`, `onHold`, `problems`, `problemRows` (Excel row number and message; a bad amount or type is reported, not skipped), `cityId`.

**Which city.** The Claims Detail sheet has no city, and a claim only counts for the city its file was uploaded for. The upload has no city field, so the city is taken from the report's own routes: the claims are stored only if every route belongs to **one** city. If the routes name no city, or more than one, nothing is stored and `reason` says so (upload one city's report at a time). A claim is never put on a guessed city. A city admin is also checked against their cities (the existing upload check already refuses a report of another city's routes).

**Courier spelling.** The claims are stored with courier `gofo` (lower case), the spelling the waybill history uses. `GOFO` would never find any history.

**Safety.** The claims step runs in its own savepoint after the history is saved: if it fails (for example the claims migration is not run yet), the pay upload and the history are stored exactly as before and the answer says `stored: false` with a reason. The matching is limited to this upload's waybills. Nothing is deducted here: a matched claim is `chargeable` and reaches a driver only through a pay run (#143).

**Money impact.** Indirect only (see above). Staged pay rows are unchanged; the test checks the staged count with and without the claims sheet.

**Database.** None. Needs #140, #141, #142 and #143 migrations (already merged).

**Tested** (`ASSIGNMENT_TEST_DB=1`, a private scratch copy, one rolled-back transaction, made-up data; run one test file at a time): claims stored and matched from the history of the same upload (chargeable, exempt for DFW GOFO plus Tracking interruption, waiting with no history); a bad amount reported with its row number; the same file again under another name stores nothing new; a changed amount becomes a new version; a waiting claim matches after a history-only import; a hand-entered claim holds the carrier's in `review`; a draft pay run deducts the matched claims once (15.00 + 4.00) and nothing for the exempt one; a report of two cities stores no claim; a city admin is refused for another city and works for their own; a report with no claims sheet; claims tables missing. Removing the one-city rule or the rematch fails tests. Default backend suite: 0 failures.

**Not tested.** Real carrier files through this path (counts only elsewhere), production, the upload screen: it does not show `claims` yet.

**Open decision (#138).** Can one waybill carry two separate claims of the same type? The rules assume no, and this keeps that. The owner should decide.
