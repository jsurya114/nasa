# After a weekly upload, list the enabled drivers who are not in the file

| Field | Value |
|---|---|
| Date | 2026-11-19 |
| Author | Jayasoorya Suryadas, with Claude Code (Claude Sonnet 5.5) |
| Issue / PR | none / see the pull request |
| Branch | `feat/weekly-upload-missing-drivers` |
| Type / scope | `feat(backend)` and `feat(frontend)` |
| Files touched | Backend: `services/admin/weeklyMissingDrivers.js` (new), `controllers/admin/weeklyUploadsController.js` (9 lines: one import, one call after the upload is stored, one extra field in the answer); test `weeklyMissingDrivers` (new). Frontend: `components/Admin/MissingDriversResult.jsx` (new), `components/Admin/UploadResultSummary.jsx` (2 lines); test `MissingDriversResult` (new). Journal entry. |
| Reserved files touched | `weeklyUploadsController` (Jasil's Excel zone), by the smallest possible hook; the logic is in a new file. Jasil reviews this pull request; ask him if he prefers the hook elsewhere. |

**What and why.** After a weekly upload the admin had no way to see which drivers were absent from the file, so a driver missing from the carrier's report (and so
from pay) was noticed only later. The upload answer now has `missingDrivers`, and the result screen shows a box "Drivers missing from this file".

- **Which drivers.** The cities come from the route codes in the file. A driver is listed when they are **enabled**, belong to one of those cities, and their driver
  code (the file's Delivery ID) is not in the file. Ordered by city and name; at most 200 are listed, with the real total.
- **Who sees what.** A city admin may upload only a file whose routes are all in their own cities (checked before anything is saved), so the list holds only
  their cities' drivers. The super admin sees the cities of the file.
- **A warning only.** It runs after the upload is committed, on the same connection as the revenue check. It never changes what was stored. If the check fails
  the answer says `{ checked: false }` and the screen says it could not check; the upload is not reported as failed. A server that does not send the field shows nothing.
- The screen says a driver can be missing for a good reason (time off). The daily upload is not changed.

**Database.** None.

**Config and dependencies.** None.

**Money impact.** None. No pay, rate, deduction or Excel parsing changes. The list is read-only.

**Tested.**
- Backend on a local copy (`PAYROLL_TEST_DB=1`): `weeklyMissingDrivers` 7 passed (only enabled drivers of the file's cities, not those in the file, ordered; another city and a
  disabled driver never listed; an unknown or empty file lists nobody; a list over the limit is cut with the real total; a failing database gives `checked: false`).
- Frontend: `MissingDriversResult` 5 passed, with `UploadResultSummary` 10 and `RevenueResult` 7 still passing.
- `gofoWeeklyUpload` has 10 failures, the same 10 on a clean `develop` (leftover committed rows in my local test database); `evereeOnboardingGate` 12 passed.

**Not tested.** A real upload of an Excel file through the endpoint end to end (the existing upload tests fail on this local database for the reason above), and a browser run.

**Risks and follow-ups.** The comparison is by driver code only; a driver who changed code, or a file that spells a code differently, is listed as missing. Drivers on
leave are listed too (they are enabled). A later version could ignore drivers with no journeys in the period.
