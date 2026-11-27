# Weekly upload: list what is in the file but not in the app

| Field | Value |
|---|---|
| Date | 2026-11-26 |
| Author | Jayasoorya, with Claude Code (Claude Sonnet 5.5) |
| Issue / PR | none / pull request into `develop` (see the PR) |
| Branch | `feat/weekly-unmatched-drivers` (from `develop`) |
| Type / scope | `feat(excel)` |
| Files touched | `Backend/services/admin/weeklyUnmatchedRows.js` (new), `Backend/tests/weeklyUnmatchedRows.test.js` (new), `Backend/controllers/admin/weeklyUploadsController.js`, `Frontend/src/components/Admin/UnmatchedRowsResult.jsx` (new), `UnmatchedRowsResult.test.jsx` (new), `UploadResultSummary.jsx`, this entry. |
| Reserved files touched | `weeklyUploadsController` (7 lines: one call and one field in the answer). Jasil gave his OK on Slack on 26 Nov 2026. `weeklyExcelQueries` is not changed. |

**What and why.** "Calculate Driver Payment" adds the staged weekly lines to the Dashboard with an INNER JOIN: a line whose Delivery ID is not an enabled driver's code, or whose route is not an enabled route with a city, is skipped without a word, so that driver's pay is missing until someone checks the Excel by hand. After a weekly upload the result now shows **In the file but not in the app**:
- a count line: rows in the file = will be added + already on the dashboard + Delivery ID not in the app + driver disabled + route not in the app + route disabled + route has no city + could not be read. Every data row is counted once; if the parts ever do not add up the screen says so in red.
- each Delivery ID that will be left out, with "Not in the app" or "Driver is disabled", its routes, days, packages, FS and DS, and the driver pay those lines give at the route prices, labelled "estimate from route prices". No names or contact details (the file has none).
- each route that is not in the app, disabled, or has no city.

**How.** A separate read-only query on the lines the upload already built (no third opening of the workbook) applies the same matching as the Dashboard step, so the counts are what that step will do. The existing INNER JOIN and everything stored are unchanged. It runs after the upload is committed; a failure shows "could not check" and never fails the upload. Lists stop at 200 entries each, with the total.

**Database.** None (read only). **Config and dependencies.** None. **Money impact.** None: nothing stored or paid changes. The estimate is display only.

**Tested.** Backend suite 367 passed (DB tests skipped without a database), and the new DB test passed on a local copy (`PAYROLL_TEST_DB=1`, one rolled-back transaction, synthetic city, routes and drivers): every reason, the count line, grouping by Delivery ID over days and routes, estimates to the cent, a line with no route price. Frontend suite 360 passed. By hand on the local copy: a real Tyler weekly file uploaded through the screen; the count line added up and the left-out Delivery IDs, disabled drivers and estimates showed as expected. Calculate Driver Payment was not pressed. **Not tested:** on production; a city admin's view (the file's routes are already limited to their cities).

**Risks and follow-ups.** The estimate uses the route's driver prices only (no insurance or deductions), so it can differ from the final pay. If two drivers share one code, or two routes one code, the check follows the first enabled one, like the Dashboard step's matching does in practice.
